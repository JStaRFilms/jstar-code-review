// src/orchestrator.ts
// The Runner: J Star Code Review Orchestrator
// Uses the Vercel AI SDK for structured output with Zod validation.

import { generateObject, generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

import { TRIAGE_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT, buildAnalystUserPrompt } from './prompts.js';
import {
    TriageSchema,
    JStarReviewSchema,
    EnvSchema,
    type TriageResult,
    type JStarReviewResult,
    type Finding,
} from './types.js';

// Initialize Groq provider
const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY,
});

// Model configuration from env
const TRIAGE_MODEL = process.env.TRIAGE_MODEL || 'openai/gpt-oss-120b';
const ANALYST_MODEL = process.env.ANALYST_MODEL || 'moonshotai/kimi-k2-instruct-0905';

// ============================================================
// ENVIRONMENT VALIDATION
// ============================================================

function validateEnv() {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
        console.error('❌ Environment validation failed:');
        result.error.errors.forEach((err) => {
            console.error(`   - ${err.path.join('.')}: ${err.message}`);
        });
        process.exit(1);
    }
    return result.data;
}

// ============================================================
// GITHUB CONTEXT
// ============================================================

interface GitHubContext {
    owner: string;
    repo: string;
    prNumber: number;
    commentId?: number;
    octokit: Octokit;
}

function initGitHub(env: ReturnType<typeof validateEnv>): GitHubContext {
    const [owner, repo] = env.GITHUB_REPOSITORY.split('/');
    return {
        owner,
        repo,
        prNumber: parseInt(env.PR_NUMBER, 10),
        commentId: env.COMMENT_ID ? parseInt(env.COMMENT_ID, 10) : undefined,
        octokit: new Octokit({ auth: env.GITHUB_TOKEN }),
    };
}

// ============================================================
// ARCHITECTURE CONTEXT LOADING
// ============================================================

function loadArchitectureContext(): string {
    let contextDocs = "";
    const docs = [
        { name: 'ARCHITECTURE', file: '.jstar/architecture.md' },
        { name: 'CODING RULES', file: '.jstar/rules.md' }
    ];

    for (const doc of docs) {
        const filePath = path.join(process.cwd(), doc.file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            contextDocs += `\n### ${doc.name}:\n${content}\n`;
            console.log(`📖 Loaded context: ${doc.file}`);
        }
    }
    return contextDocs;
}

// ============================================================
// DOC DRIFT DETECTION
// ============================================================

interface DocFinding {
    file: string;
    line: number;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'NITPICK';
    category: string;
    message: string;
    fix_prompt?: string;
}

interface DocDriftMapping {
    sourcePath: string;
    docsPath: string;
    description: string;
}

interface JStarConfig {
    docDrift?: {
        enabled: boolean;
        mappings: DocDriftMapping[];
    };
}

function loadJStarConfig(): JStarConfig {
    const configPath = path.join(process.cwd(), '.jstar/config.json');
    if (fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            console.log('⚠️ Could not parse .jstar/config.json, using defaults');
        }
    }
    // Default config if no file exists
    return {
        docDrift: {
            enabled: true,
            mappings: [
                { sourcePath: 'src/features/', docsPath: 'docs/features/', description: 'Feature modules' }
            ]
        }
    };
}

async function checkDocDrift(prFiles: string[]): Promise<DocFinding[]> {
    const findings: DocFinding[] = [];
    const config = loadJStarConfig();

    if (!config.docDrift?.enabled) {
        console.log('📚 Doc drift check disabled in config.');
        return findings;
    }

    const mappings = config.docDrift.mappings;

    // Track touched items per mapping
    const touchedItems: Map<DocDriftMapping, Set<string>> = new Map();

    for (const mapping of mappings) {
        touchedItems.set(mapping, new Set());
    }

    // 1. Identify which items were touched for each mapping
    for (const file of prFiles) {
        for (const mapping of mappings) {
            if (file.startsWith(mapping.sourcePath)) {
                // Extract the item name (first folder/file after the source path)
                const relativePath = file.slice(mapping.sourcePath.length);
                const itemName = relativePath.split('/')[0];
                if (itemName) {
                    touchedItems.get(mapping)!.add(itemName);
                }
            }
        }
    }

    // Count total touched items
    let totalTouched = 0;
    for (const items of touchedItems.values()) {
        totalTouched += items.size;
    }

    if (totalTouched === 0) {
        console.log('📚 No tracked folders touched, skipping doc drift check.');
        return findings;
    }

    console.log(`📚 Checking documentation for ${totalTouched} touched items...`);

    // 2. Check if docs exist/updated for each touched item
    for (const [mapping, items] of touchedItems.entries()) {
        for (const item of items) {
            const expectedDocPath = `${mapping.docsPath}${item}`;
            const hasDocUpdate = prFiles.some(f => f.startsWith(expectedDocPath));

            if (!hasDocUpdate) {
                console.log(`   ⚠️ Missing docs for: ${mapping.sourcePath}${item} (${mapping.description})`);

                // 3. Generate a documentation stub using AI
                try {
                    const { text: docDraft } = await generateText({
                        model: groq(TRIAGE_MODEL),
                        system: "You are a Technical Writer. Generate a brief, concise markdown documentation stub. Keep it under 200 words.",
                        prompt: `The developer updated "${item}" in ${mapping.sourcePath}${item}/ but forgot to document it.\n\nWrite a concise markdown template for ${mapping.docsPath}${item}.md explaining:\n1. What this ${mapping.description.toLowerCase()} does (placeholder)\n2. Key files\n3. Usage notes\n\nKeep it minimal and professional.`,
                    });

                    findings.push({
                        file: `${mapping.docsPath}${item}.md`,
                        line: 1,
                        severity: 'HIGH',
                        category: 'DOCUMENTATION',
                        message: `🚨 **Doc Drift Detected:** You modified \`${mapping.sourcePath}${item}/\` but didn't update the documentation in \`${mapping.docsPath}\`.`,
                        fix_prompt: `Create file ${mapping.docsPath}${item}.md with this content:\n\n${docDraft}`
                    });
                } catch (e) {
                    findings.push({
                        file: `${mapping.docsPath}${item}.md`,
                        line: 1,
                        severity: 'HIGH',
                        category: 'DOCUMENTATION',
                        message: `🚨 **Doc Drift Detected:** You modified \`${mapping.sourcePath}${item}/\` but didn't update the documentation in \`${mapping.docsPath}\`.`,
                        fix_prompt: `Create documentation for ${item} in ${mapping.docsPath}${item}.md`
                    });
                }
            } else {
                console.log(`   ✅ Docs updated for: ${mapping.sourcePath}${item}`);
            }
        }
    }

    return findings;
}

// ============================================================
// PR DIFF FETCHING
// ============================================================

async function fetchPRDiff(ctx: GitHubContext): Promise<string> {
    const response = await ctx.octokit.pulls.get({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.prNumber,
        mediaType: { format: 'diff' },
    });

    return response.data as unknown as string;
}

async function fetchPRFiles(ctx: GitHubContext): Promise<string[]> {
    const response = await ctx.octokit.pulls.listFiles({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.prNumber,
        per_page: 100,
    });

    return response.data.map((file) => file.filename);
}

// ============================================================
// TRIAGE (Step 1: Cheap Gatekeeper)
// ============================================================

async function runTriage(files: string[], diffLength: number): Promise<TriageResult> {
    console.log(`🔍 Running Triage with ${TRIAGE_MODEL}...`);

    const { object } = await generateObject({
        model: groq(TRIAGE_MODEL),
        schema: TriageSchema,
        system: TRIAGE_SYSTEM_PROMPT,
        prompt: `
PR contains ${files.length} files. Diff length: ${diffLength} characters.

Files changed:
${files.map((f) => `- ${f}`).join('\n')}

Classify this PR and identify critical files to audit.
`,
    });

    return object;
}

// ============================================================
// DEEP REVIEW (Step 2: Expensive Analyst)
// ============================================================

async function runDeepReview(filesToAudit: string[], diff: string, architectureContext: string): Promise<JStarReviewResult> {
    console.log(`🧠 Running Deep Review on ${filesToAudit.length} files with ${ANALYST_MODEL}...`);

    // Inject architecture context into the system prompt
    const enhancedSystemPrompt = architectureContext
        ? `${ANALYST_SYSTEM_PROMPT}\n\n--- PROJECT CONTEXT ---\n${architectureContext}`
        : ANALYST_SYSTEM_PROMPT;

    const { object } = await generateObject({
        model: groq(ANALYST_MODEL),
        schema: JStarReviewSchema,
        system: enhancedSystemPrompt,
        prompt: buildAnalystUserPrompt(filesToAudit, diff),
    });

    return object;
}

// ============================================================
// MARKDOWN FORMATTING
// ============================================================

function formatTriageSkipComment(triage: TriageResult): string {
    return `## ✨ J Star Triage

**Risk Level:** ${triage.risk_level}

${triage.ignore_reason ? `> ${triage.ignore_reason}` : ''}

No critical files detected. Skipping deep review to save tokens. 🎉
`;
}

function formatReviewComment(review: JStarReviewResult, docFindings: DocFinding[]): string {
    const allFindings = [...docFindings, ...review.findings];
    const hasDocIssues = docFindings.length > 0;

    // Adjust score if there are doc issues
    const score = hasDocIssues
        ? Math.min(review.summary.risk_score, 60) // Penalty for missing docs
        : review.summary.risk_score;

    const icon = score > 80 ? '🟢' : score > 50 ? '🟡' : '🔴';
    const verdict = hasDocIssues ? 'REQUEST_CHANGES' : review.summary.verdict;

    // 1. The Executive Summary Table
    let md = `# ${icon} J Star Code Audit\n\n`;
    md += `| Metric | Result | Status |\n`;
    md += `| :--- | :--- | :--- |\n`;
    md += `| **Risk Score** | ${score}/100 | ${score > 80 ? 'Safe' : 'Risky'} |\n`;
    md += `| **Verdict** | ${verdict} | ${verdict === 'APPROVE' ? '✅' : '⚠️'} |\n`;
    md += `| **Tone** | ${review.summary.tone.toUpperCase()} | 🤖 |\n`;
    if (hasDocIssues) {
        md += `| **Doc Drift** | ${docFindings.length} missing | 📚 |\n`;
    }
    md += `\n---\n\n`;

    // 2. Documentation Findings (if any)
    if (docFindings.length > 0) {
        md += `## 📚 Documentation Issues\n\n`;
        for (const finding of docFindings) {
            md += `### 🔶 ${finding.severity}: ${finding.file}\n`;
            md += `**Category:** \`${finding.category}\`\n\n`;
            md += `> ${finding.message}\n\n`;
            if (finding.fix_prompt) {
                md += `<details>\n<summary><b>🛠️ Click to Copy AI Fix Prompt</b></summary>\n\n`;
                md += `\`\`\`text\n${finding.fix_prompt}\n\`\`\`\n`;
                md += `</details>\n\n`;
            }
            md += `---\n`;
        }
    }

    // 3. Code Findings
    md += `## 🔍 Code Review Findings\n\n`;

    if (review.findings.length === 0) {
        md += `*No critical code issues found. Great job!* ✨\n`;
    }

    for (const finding of review.findings) {
        const severityIcon = finding.severity === 'CRITICAL' ? '🚨' : finding.severity === 'HIGH' ? '🔶' : '🔹';

        md += `### ${severityIcon} ${finding.severity}: ${finding.file}\n`;
        md += `**Category:** \`${finding.category}\` | **Line:** ${finding.line}\n\n`;
        md += `> ${finding.message}\n\n`;

        if (finding.fix_prompt) {
            md += `<details>\n<summary><b>🛠️ Click to Copy AI Fix Prompt</b></summary>\n\n`;
            md += `\`\`\`text\n${finding.fix_prompt}\n\`\`\`\n`;
            md += `</details>\n\n`;
        }
        md += `---\n`;
    }

    md += `\n*Powered by J Star Sentinel & Kimi-k2* ⚡`;
    return md;
}

// ============================================================
// COMMENT POSTING
// ============================================================

async function postComment(ctx: GitHubContext, body: string): Promise<void> {
    await ctx.octokit.issues.createComment({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: ctx.prNumber,
        body,
    });
    console.log('💬 Comment posted to PR.');
}

// ============================================================
// REACTION LOGIC
// ============================================================

async function addReaction(ctx: GitHubContext, reaction: 'eyes' | 'rocket') {
    if (!ctx.commentId) return;

    try {
        await ctx.octokit.reactions.createForIssueComment({
            owner: ctx.owner,
            repo: ctx.repo,
            comment_id: ctx.commentId,
            content: reaction,
        });
        console.log(`👀 Reacted with ${reaction}`);
    } catch (e) {
        console.log("⚠️ Could not react (might be a permission issue or invalid comment ID)");
    }
}

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

async function main() {
    console.log('🚀 J Star Reviewer Initialized');
    console.log('================================\n');

    // 1. Validate environment
    const env = validateEnv();
    const ctx = initGitHub(env);

    // Quick Win: React immediately if triggered by comment
    await addReaction(ctx, 'eyes');

    console.log(`📦 Reviewing PR #${ctx.prNumber} in ${ctx.owner}/${ctx.repo}\n`);

    // 2. Load architecture context (if available)
    const architectureContext = loadArchitectureContext();

    // 3. Fetch PR data
    const [diff, files] = await Promise.all([
        fetchPRDiff(ctx),
        fetchPRFiles(ctx),
    ]);
    console.log(`📄 Found ${files.length} changed files (${diff.length} chars diff)\n`);

    // 4. Run Triage
    const triage = await runTriage(files, diff.length);
    console.log(`\n📊 Triage Result:`, JSON.stringify(triage, null, 2), '\n');

    // 5. Check Doc Drift (NEW!)
    const docFindings = await checkDocDrift(files);

    // 6. Check if we should skip deep review
    if (triage.files_to_audit.length === 0 && docFindings.length === 0) {
        console.log('⏭️  No critical files. Posting skip comment...');
        await postComment(ctx, formatTriageSkipComment(triage));
        return;
    }

    // 7. Run Deep Review (if there are code files to audit)
    let review: JStarReviewResult;
    if (triage.files_to_audit.length > 0) {
        review = await runDeepReview(triage.files_to_audit, diff, architectureContext);
        console.log(`\n🔬 Review Result:`, JSON.stringify(review, null, 2), '\n');
    } else {
        // Create a minimal review object if only doc drift was found
        review = {
            summary: {
                risk_score: 70,
                verdict: 'REQUEST_CHANGES',
                tone: 'critical'
            },
            findings: []
        };
    }

    // 8. Post Review Comment (with doc findings merged)
    await postComment(ctx, formatReviewComment(review, docFindings));

    console.log('\n🏁 J Star Review Complete!');
}

// ============================================================
// RUN
// ============================================================

main().catch((error) => {
    console.error('❌ J Star Reviewer crashed:', error);
    process.exit(1);
});
