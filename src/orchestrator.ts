// src/orchestrator.ts
// The Runner: J Star Code Review Orchestrator
// Lean version: ~200 lines. No regex. Pure AI reasoning.

import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

import { TRIAGE_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT, buildAnalystUserPrompt, CHUNK_REVIEW_SYSTEM_PROMPT, buildChunkReviewPrompt } from './prompts.js';
import {
    TriageSchema,
    JStarReviewSchema,
    ChunkReviewSchema,
    EnvSchema,
    type TriageResult,
    type JStarReviewResult,
    type ChunkReviewResult,
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
// ENVIRONMENT & CONTEXT
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

function loadArchitectureContext(): string {
    let contextDocs = "";
    const docs = [
        { name: 'ARCHITECTURE', file: '.jstar/architecture.md' },
        { name: 'CODING RULES', file: '.jstar/rules.md' }
    ];

    for (const doc of docs) {
        const filePath = path.join(process.cwd(), doc.file);
        if (fs.existsSync(filePath)) {
            contextDocs += `\n### ${doc.name}:\n${fs.readFileSync(filePath, 'utf-8')}\n`;
            console.log(`📖 Loaded context: ${doc.file}`);
        }
    }
    return contextDocs;
}

// ============================================================
// GITHUB API
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

async function postComment(ctx: GitHubContext, body: string): Promise<void> {
    await ctx.octokit.issues.createComment({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: ctx.prNumber,
        body,
    });
    console.log('💬 Comment posted to PR.');
}

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
        console.log("⚠️ Could not react");
    }
}

// ============================================================
// AI STAGES
// ============================================================

async function runTriage(files: string[], diffLength: number): Promise<TriageResult> {
    console.log(`🔍 Running Triage with ${TRIAGE_MODEL}...`);

    const { object } = await generateObject({
        model: groq(TRIAGE_MODEL),
        schema: TriageSchema,
        system: TRIAGE_SYSTEM_PROMPT,
        prompt: `PR contains ${files.length} files. Diff length: ${diffLength} chars.\n\nFiles:\n${files.join('\n')}`,
    });

    return object;
}

async function runDeepReview(filesToAudit: string[], allFiles: string[], diff: string, architectureContext: string): Promise<JStarReviewResult> {
    console.log(`🧠 Running Deep Review with ${ANALYST_MODEL}...`);

    // Estimate tokens (rough: 4 chars per token)
    const estimatedTokens = Math.ceil(diff.length / 4);
    const TOKEN_LIMIT = 8000; // Safe buffer under 10K TPM

    if (estimatedTokens <= TOKEN_LIMIT) {
        // Small diff: use single-shot review (original behavior)
        console.log(`📦 Diff size OK (${estimatedTokens} est. tokens), using single-shot review`);
        return runSingleShotReview(filesToAudit, allFiles, diff, architectureContext);
    }

    // Large diff: use chunked map-reduce
    console.log(`📦 Diff too large (${estimatedTokens} est. tokens), using chunked review`);
    return runChunkedReview(filesToAudit, diff, architectureContext);
}

/**
 * Original single-shot review for small diffs.
 */
async function runSingleShotReview(filesToAudit: string[], allFiles: string[], diff: string, architectureContext: string): Promise<JStarReviewResult> {
    const enhancedSystemPrompt = architectureContext
        ? `${ANALYST_SYSTEM_PROMPT}\n\n--- PROJECT CONTEXT ---\n${architectureContext}`
        : ANALYST_SYSTEM_PROMPT;

    const { object } = await generateObject({
        model: groq(ANALYST_MODEL),
        schema: JStarReviewSchema,
        system: enhancedSystemPrompt,
        prompt: buildAnalystUserPrompt(filesToAudit, allFiles, diff),
    });

    return object;
}

// ============================================================
// CHUNKED MAP-REDUCE REVIEW
// ============================================================

interface FileDiff {
    filename: string;
    diff: string;
}

/**
 * Parse unified diff into per-file chunks.
 */
function splitDiffByFile(diff: string): FileDiff[] {
    const fileDiffs: FileDiff[] = [];
    // Match diff headers: "diff --git a/path b/path" or "--- a/path"
    const diffPattern = /^diff --git a\/(.+?) b\/\1/gm;

    let match;
    const positions: { filename: string; start: number }[] = [];

    while ((match = diffPattern.exec(diff)) !== null) {
        positions.push({ filename: match[1], start: match.index });
    }

    // Extract each file's diff
    for (let i = 0; i < positions.length; i++) {
        const start = positions[i].start;
        const end = i + 1 < positions.length ? positions[i + 1].start : diff.length;
        fileDiffs.push({
            filename: positions[i].filename,
            diff: diff.substring(start, end).trim(),
        });
    }

    return fileDiffs;
}

/**
 * Review large diffs by chunking per-file and aggregating.
 */
async function runChunkedReview(filesToAudit: string[], diff: string, architectureContext: string): Promise<JStarReviewResult> {
    const fileDiffs = splitDiffByFile(diff);
    console.log(`🔪 Split into ${fileDiffs.length} file chunks`);

    // Filter to only audit files the triage identified as critical
    const relevantDiffs = fileDiffs.filter(fd =>
        filesToAudit.some(f => fd.filename.endsWith(f) || f.endsWith(fd.filename))
    );

    console.log(`🎯 Reviewing ${relevantDiffs.length} critical files`);

    // Review each file chunk (parallel in batches of 3 to not exceed RPM)
    const BATCH_SIZE = 3;
    const allChunkResults: ChunkReviewResult[] = [];

    for (let i = 0; i < relevantDiffs.length; i += BATCH_SIZE) {
        const batch = relevantDiffs.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(fd => reviewFileChunk(fd.filename, fd.diff, architectureContext))
        );
        allChunkResults.push(...batchResults);

        if (i + BATCH_SIZE < relevantDiffs.length) {
            console.log(`   ⏳ Reviewed ${i + BATCH_SIZE}/${relevantDiffs.length} files...`);
        }
    }

    // Aggregate results
    return aggregateChunkReviews(allChunkResults);
}

/**
 * Review a single file chunk.
 */
async function reviewFileChunk(filename: string, fileDiff: string, architectureContext: string): Promise<ChunkReviewResult> {
    try {
        const { object } = await generateObject({
            model: groq(ANALYST_MODEL),
            schema: ChunkReviewSchema,
            system: CHUNK_REVIEW_SYSTEM_PROMPT,
            prompt: buildChunkReviewPrompt(filename, fileDiff, architectureContext),
        });
        return object;
    } catch (error) {
        console.log(`⚠️ Failed to review ${filename}, skipping`);
        return { file: filename, findings: [], file_risk: 100 };
    }
}

/**
 * Combine chunk reviews into final JStarReviewResult.
 */
function aggregateChunkReviews(chunks: ChunkReviewResult[]): JStarReviewResult {
    const allFindings: Finding[] = [];
    let totalRisk = 0;

    for (const chunk of chunks) {
        allFindings.push(...chunk.findings);
        totalRisk += chunk.file_risk;
    }

    const avgRisk = chunks.length > 0 ? Math.round(totalRisk / chunks.length) : 100;

    // Determine verdict based on findings
    const hasCritical = allFindings.some(f => f.severity === 'CRITICAL');
    const hasHigh = allFindings.some(f => f.severity === 'HIGH');

    let verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'APPROVE';
    let tone: 'encouraging' | 'critical' | 'neutral' = 'encouraging';

    if (hasCritical) {
        verdict = 'REQUEST_CHANGES';
        tone = 'critical';
    } else if (hasHigh) {
        verdict = 'REQUEST_CHANGES';
        tone = 'neutral';
    } else if (allFindings.length > 0) {
        verdict = 'COMMENT';
        tone = 'neutral';
    }

    return {
        summary: {
            risk_score: avgRisk,
            verdict,
            tone,
        },
        findings: allFindings,
    };
}

// ============================================================
// FORMATTING
// ============================================================

function formatTriageSkipComment(triage: TriageResult): string {
    return `## ✨ J Star Triage\n\n**Risk Level:** ${triage.risk_level}\n\n${triage.ignore_reason ? `> ${triage.ignore_reason}` : ''}\n\nNo critical files detected. Skipping deep review. 🎉`;
}

function formatReviewComment(review: JStarReviewResult): string {
    const score = review.summary.risk_score;
    const icon = score > 80 ? '🟢' : score > 50 ? '🟡' : '🔴';
    const icons: Record<string, string> = { CRITICAL: '🚨', HIGH: '🔶', MEDIUM: '🔹', NITPICK: '🔧' };

    let md = `# ${icon} J Star Code Audit\n\n`;
    md += `| Score | Verdict | Tone |\n| :--- | :--- | :--- |\n`;
    md += `| ${score}/100 | ${review.summary.verdict} | ${review.summary.tone.toUpperCase()} |\n\n---\n\n`;

    if (review.findings.length === 0) {
        md += `*No issues found. Ship it!* ✨\n`;
    }

    for (const finding of review.findings) {
        const categoryIcon = finding.category === 'DOCUMENTATION' ? '📚 ' : '';
        md += `### ${icons[finding.severity] || '🔹'} ${categoryIcon}${finding.category}: ${finding.file}\n`;
        md += `> ${finding.message}\n\n`;
        if (finding.fix_prompt) {
            md += `<details><summary><b>🛠️ AI Fix Prompt</b></summary>\n\n\`\`\`text\n${finding.fix_prompt}\n\`\`\`\n</details>\n\n`;
        }
        md += `---\n`;
    }

    return md + `\n*Powered by J Star Sentinel* ⚡`;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    console.log('🚀 J Star Reviewer Initialized');
    console.log('================================\n');

    const env = validateEnv();
    const ctx = initGitHub(env);

    await addReaction(ctx, 'eyes');

    console.log(`📦 Reviewing PR #${ctx.prNumber} in ${ctx.owner}/${ctx.repo}\n`);

    const architectureContext = loadArchitectureContext();
    const [diff, files] = await Promise.all([fetchPRDiff(ctx), fetchPRFiles(ctx)]);
    console.log(`📄 Found ${files.length} files (${diff.length} chars diff)\n`);

    const triage = await runTriage(files, diff.length);
    console.log(`\n📊 Triage:`, JSON.stringify(triage, null, 2), '\n');

    if (triage.files_to_audit.length === 0) {
        await postComment(ctx, formatTriageSkipComment(triage));
        return;
    }

    // AI handles doc drift detection via the prompt
    const review = await runDeepReview(triage.files_to_audit, files, diff, architectureContext);
    console.log(`\n🔬 Review:`, JSON.stringify(review, null, 2), '\n');

    await postComment(ctx, formatReviewComment(review));
    console.log('\n🏁 J Star Review Complete!');
}

main().catch((error) => {
    console.error('❌ J Star Reviewer crashed:', error);
    process.exit(1);
});
