// src/orchestrator.ts
// The Runner: J Star Code Review Orchestrator
// Uses the Vercel AI SDK for structured output with Zod validation.

import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { Octokit } from '@octokit/rest';

import { TRIAGE_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT, buildAnalystUserPrompt } from './prompts.js';
import {
    TriageSchema,
    JStarReviewSchema,
    EnvSchema,
    type TriageResult,
    type JStarReviewResult,
    type Finding,
    type Verdict,
} from './types.js';

// Initialize Groq provider
const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY,
});

// Model configuration from env
const TRIAGE_MODEL = process.env.TRIAGE_MODEL || 'llama-3.1-8b-instant';
const ANALYST_MODEL = process.env.ANALYST_MODEL || 'llama-3.3-70b-versatile';

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
// PR DIFF FETCHING
// ============================================================

async function fetchPRDiff(ctx: GitHubContext): Promise<string> {
    const response = await ctx.octokit.pulls.get({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.prNumber,
        mediaType: { format: 'diff' },
    });

    // The diff comes as a string when mediaType is 'diff'
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

async function runDeepReview(filesToAudit: string[], diff: string): Promise<JStarReviewResult> {
    console.log(`🧠 Running Deep Review on ${filesToAudit.length} files with ${ANALYST_MODEL}...`);

    const { object } = await generateObject({
        model: groq(ANALYST_MODEL),
        schema: JStarReviewSchema,
        system: ANALYST_SYSTEM_PROMPT,
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

function formatReviewComment(review: JStarReviewResult): string {
    const score = review.summary.risk_score;
    const icon = score > 80 ? '🟢' : score > 50 ? '🟡' : '🔴';

    // 1. The Executive Summary Table
    let md = `# ${icon} J Star Code Audit\n\n`;
    md += `| Metric | Result | Status |\n`;
    md += `| :--- | :--- | :--- |\n`;
    md += `| **Risk Score** | ${score}/100 | ${score > 80 ? 'Safe' : 'Risky'} |\n`;
    md += `| **Verdict** | ${review.summary.verdict} | ${review.summary.verdict === 'APPROVE' ? '✅' : '⚠️'} |\n`;
    md += `| **Tone** | ${review.summary.tone.toUpperCase()} | 🤖 |\n\n`;

    md += `---\n\n`;

    // 2. The Detailed Findings
    md += `## 🔍 Deep Dive Findings\n\n`;

    if (review.findings.length === 0) {
        md += `*No critical issues found. Great job!* ✨\n`;
    }

    for (const finding of review.findings) {
        const severityIcon = finding.severity === 'CRITICAL' ? '🚨' : finding.severity === 'HIGH' ? '🔶' : '🔹';

        md += `### ${severityIcon} ${finding.severity}: ${finding.file}\n`;
        md += `**Category:** \`${finding.category}\` | **Line:** ${finding.line}\n\n`;

        // The "Impact" section helps believability
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
    if (!ctx.commentId) return; // Only works if triggered by a comment

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

    // 2. Fetch PR data
    const [diff, files] = await Promise.all([
        fetchPRDiff(ctx),
        fetchPRFiles(ctx),
    ]);
    console.log(`📄 Found ${files.length} changed files (${diff.length} chars diff)\n`);

    // 3. Run Triage
    const triage = await runTriage(files, diff.length);
    console.log(`\n📊 Triage Result:`, JSON.stringify(triage, null, 2), '\n');

    // 4. Check if we should skip deep review
    if (triage.files_to_audit.length === 0) {
        console.log('⏭️  No critical files. Posting skip comment...');
        await postComment(ctx, formatTriageSkipComment(triage));
        return;
    }

    // 5. Run Deep Review
    const review = await runDeepReview(triage.files_to_audit, diff);
    console.log(`\n🔬 Review Result:`, JSON.stringify(review, null, 2), '\n');

    // 6. Post Review Comment
    await postComment(ctx, formatReviewComment(review));

    console.log('\n🏁 J Star Review Complete!');
}

// ============================================================
// RUN
// ============================================================

main().catch((error) => {
    console.error('❌ J Star Reviewer crashed:', error);
    process.exit(1);
});
