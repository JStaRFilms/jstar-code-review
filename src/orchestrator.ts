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

// ============================================================
// REMOTE CONTEXT LOADING (GitHub API)
// ============================================================

/**
 * Helper to fetch a single file content from the remote repo.
 * Returns null if not found.
 */
async function fetchRemoteFile(ctx: GitHubContext, path: string): Promise<string | null> {
    try {
        const { data } = await ctx.octokit.repos.getContent({
            owner: ctx.owner,
            repo: ctx.repo,
            path: path,
        });

        if (Array.isArray(data) || !('content' in data)) {
            return null; // It's a directory or submodule
        }

        return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (e: any) {
        if (e.status !== 404) {
            console.log(`⚠️ Error fetching ${path}: ${e.message}`);
        }
        return null; // Not found
    }
}

async function loadArchitectureContext(ctx: GitHubContext): Promise<string> {
    let contextDocs = "";
    const docs = [
        { name: 'ARCHITECTURE', file: '.jstar/architecture.md' },
        { name: 'CODING RULES', file: '.jstar/rules.md' }
    ];

    for (const doc of docs) {
        const content = await fetchRemoteFile(ctx, doc.file);
        if (content) {
            contextDocs += `\n### ${doc.name}:\n${content}\n`;
            console.log(`📖 Loaded remote context: ${doc.file}`);
        }
    }
    return contextDocs;
}

/**
 * Scan the docs/features folder on remote.
 * Returns a map of feature names to their doc files.
 */
async function loadDocsInventory(ctx: GitHubContext): Promise<Map<string, string>> {
    const inventory = new Map<string, string>();
    const targetDirs = ['docs/features'];

    for (const docsDir of targetDirs) {
        // Remove leading/trailing slashes for cleanliness
        const cleanPath = docsDir.replace(/^\/+|\/+$/g, '');

        try {
            const { data } = await ctx.octokit.repos.getContent({
                owner: ctx.owner,
                repo: ctx.repo,
                path: cleanPath,
            });

            if (Array.isArray(data)) {
                for (const file of data) {
                    if (file.name.endsWith('.md') && file.type === 'file') {
                        // Extract feature name (e.g., "themes.md" -> "themes")
                        const featureName = file.name.replace('.md', '');
                        inventory.set(featureName, file.path);
                    }
                }
            }
        } catch (e: any) {
            if (e.status === 404) {
                console.log(`📁 Remote directory not found: ${cleanPath}`);
            } else {
                console.log(`⚠️ Failed to scan remote ${cleanPath}: ${e.message}`);
            }
        }
    }

    if (inventory.size > 0) {
        console.log(`📚 Found ${inventory.size} remote feature docs: ${[...inventory.keys()].join(', ')}`);
    }

    return inventory;
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

async function runDeepReview(filesToAudit: string[], allFiles: string[], diff: string, architectureContext: string, existingDocs: string[]): Promise<JStarReviewResult> {
    console.log(`🧠 Running Deep Review with ${ANALYST_MODEL}...`);

    // Estimate tokens (rough: 4 chars per token)
    const estimatedTokens = Math.ceil(diff.length / 4);
    const TOKEN_LIMIT = 8000; // Safe buffer under 10K TPM

    if (estimatedTokens <= TOKEN_LIMIT) {
        // Small diff: use single-shot review (original behavior)
        const rawResult = await runSingleShotReview(filesToAudit, allFiles, diff, architectureContext, existingDocs);
        return adjustScoreForSkippedFiles(rawResult, filesToAudit.length, allFiles.length);
    }

    // Large diff: use chunked map-reduce
    console.log(`📦 Diff too large (${estimatedTokens} est. tokens), using chunked review`);
    const rawResult = await runChunkedReview(filesToAudit, diff, architectureContext, existingDocs);
    return adjustScoreForSkippedFiles(rawResult, filesToAudit.length, allFiles.length);
}

/**
 * Adjusts the score to account for files that were skipped by Triage (assumed safe/100).
 * Rule: Final Score = ((RawScore * AuditedCount) + (100 * SkippedCount)) / TotalCount
 */
function adjustScoreForSkippedFiles(result: JStarReviewResult, auditedCount: number, totalCount: number): JStarReviewResult {
    if (totalCount === 0) return result;

    // Cap auditedCount at totalCount to prevent negative skipped (e.g. if filesToAudit includes deleted files)
    const effectiveAudited = Math.min(auditedCount, totalCount);
    const skippedCount = totalCount - effectiveAudited;

    if (skippedCount <= 0) return result;

    const currentScore = result.summary.quality_score;
    const weightedScore = Math.round(
        ((currentScore * effectiveAudited) + (100 * skippedCount)) / totalCount
    );

    console.log(`⚖️  Weighted Score Adjustment:`);
    console.log(`    - Raw Score (Audited Files): ${currentScore}`);
    console.log(`    - Audited Files: ${effectiveAudited}`);
    console.log(`    - Skipped Files (Assumed 100): ${skippedCount}`);
    console.log(`    - New Weighted Score: ${weightedScore}`);

    return {
        ...result,
        summary: {
            ...result.summary,
            quality_score: weightedScore
        }
    };
}

/**
 * Original single-shot review for small diffs.
 */
async function runSingleShotReview(filesToAudit: string[], allFiles: string[], diff: string, architectureContext: string, existingDocs: string[]): Promise<JStarReviewResult> {
    const enhancedSystemPrompt = architectureContext
        ? `${ANALYST_SYSTEM_PROMPT}\n\n--- PROJECT CONTEXT ---\n${architectureContext}`
        : ANALYST_SYSTEM_PROMPT;

    const { object } = await generateObject({
        model: groq(ANALYST_MODEL),
        schema: JStarReviewSchema,
        system: enhancedSystemPrompt,
        prompt: buildAnalystUserPrompt(filesToAudit, allFiles, diff, existingDocs),
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
async function runChunkedReview(filesToAudit: string[], diff: string, architectureContext: string, existingDocs: string[]): Promise<JStarReviewResult> {
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
            batch.map(fd => reviewFileChunk(fd.filename, fd.diff, architectureContext, existingDocs))
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
async function reviewFileChunk(filename: string, fileDiff: string, architectureContext: string, existingDocs: string[]): Promise<ChunkReviewResult> {
    try {
        const { object } = await generateObject({
            model: groq(ANALYST_MODEL),
            schema: ChunkReviewSchema,
            system: CHUNK_REVIEW_SYSTEM_PROMPT,
            prompt: buildChunkReviewPrompt(filename, fileDiff, architectureContext, existingDocs),
        });
        return object;
    } catch (error) {
        console.log(`⚠️ Failed to review ${filename}, skipping`);
        return { file: filename, findings: [], quality_score: 0 };
    }
}

/**
 * Combine chunk reviews into final JStarReviewResult.
 */
function aggregateChunkReviews(chunks: ChunkReviewResult[]): JStarReviewResult {
    const allFindings: Finding[] = [];
    let totalQuality = 0;

    for (const chunk of chunks) {
        allFindings.push(...chunk.findings);
        totalQuality += chunk.quality_score;
    }

    const avgQuality = chunks.length > 0 ? Math.round(totalQuality / chunks.length) : 0;

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
            quality_score: avgQuality,
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
    return `## ✨ J Star Triage

**Risk Level:** ${triage.risk_level}

${triage.ignore_reason ? `> ${triage.ignore_reason}` : ''}

No critical files detected. Skipping deep review. 🎉`;
}

function formatReviewComment(review: JStarReviewResult): string {
    const score = review.summary.quality_score;
    const verdict = review.summary.verdict;

    // 1. Calculate Metrics
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, NITPICK: 0 };
    for (const f of review.findings) {
        counts[f.severity]++;
    }
    const totalFindings = review.findings.length;

    // 2. Determine Mode
    // High-Density Mode if >= 30 findings (Bumped from 15 to show Grouped Fixes more often)
    const isHighDensity = totalFindings >= 30;

    // 3. Header (Score + Summary Table)
    const icon = score > 80 ? '🟢' : score > 50 ? '🟡' : '🔴';
    let md = `# ${icon} J Star Code Audit\n\n`;

    // Simple metrics table (Canonical Rule 2)
    md += `| Score | Verdict | 🚨 Critical | 🔶 High | 🔹 Medium | 🔧 Nitpick |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    md += `| **${score}/100** | **${verdict}** | ${counts.CRITICAL || '-'} | ${counts.HIGH || '-'} | ${counts.MEDIUM || '-'} | ${counts.NITPICK || '-'} |\n\n`;

    if (totalFindings === 0) {
        md += `### ✨ No issues found. Ship it!\n\n---\n\n`;
        md += `Powered by J Star Sentinel ⚡`;
        return md;
    }

    // Group findings by file
    const byFile = new Map<string, Finding[]>();
    for (const f of review.findings) {
        if (!byFile.has(f.file)) byFile.set(f.file, []);
        byFile.get(f.file)!.push(f);
    }

    // Icons mapping
    const sevIcons: Record<string, string> = { CRITICAL: '🚨', HIGH: '🔶', MEDIUM: '🔹', NITPICK: '🔧' };

    // 4. Render Body based on Mode
    if (isHighDensity) {
        md += `**SUMMARY MODE** (High finding count detected)\n\n`;

        for (const [file, findings] of byFile) {
            md += `### 📄 ${file}\n\n`;
            md += `| Sev | Cat | Issue | Fix |\n`;
            md += `| :--- | :--- | :--- | :--- |\n`;

            for (const f of findings) {
                const title = f.title || f.message.substring(0, 50); // Fallback if title missing during migration
                const desc = f.message;
                const fix = f.fix_prompt ? `\`${f.fix_prompt.substring(0, 50)}${f.fix_prompt.length > 50 ? '...' : ''}\`` : 'See comments';
                md += `| ${sevIcons[f.severity]} | ${f.category} | **${title}**<br>${desc} | ${fix} |\n`;
            }
            md += `\n`;
        }

    } else {

        // Default Mode (Standard PR Review)
        for (const [file, findings] of byFile) {
            md += `## 📄 ${file}\n\n`;

            const fixes: string[] = [];

            for (const f of findings) {
                const title = f.title || 'Untitled Issue';
                const isAlertAndCritical = f.severity === 'CRITICAL';
                const isAlertAndHigh = f.severity === 'HIGH';

                if (f.fix_prompt) {
                    fixes.push(`**${title}**: ${f.fix_prompt}`);
                }

                // Rule 3: GitHub Alerts for CRITICAL/HIGH
                if (isAlertAndCritical || isAlertAndHigh) {
                    const alertType = isAlertAndCritical ? 'CAUTION' : 'WARNING';

                    md += `> [!${alertType}]\n`;
                    md += `> **${title}**\n`;
                    md += `> ${f.message}\n`;
                    md += `\n`; // End blockquote
                } else {
                    // Standard Rendering for Medium/Nitpick
                    md += `### ${sevIcons[f.severity]} ${title}\n`;
                    md += `**Category:** ${f.category}\n\n`;
                    md += `${f.message}\n\n`;
                }
            }

            if (fixes.length > 0) {
                md += `**🛠️ Recommended Fixes**\n\n`;
                for (const fix of fixes) {
                    md += `- ${fix}\n`;
                }
            }
            md += `\n---\n\n`;
        }
    }

    // 5. Footer (Canonical Rule 7)
    md += `Powered by J Star Sentinel ⚡`;
    return md;
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

    const architectureContext = await loadArchitectureContext(ctx);
    const docsInventory = await loadDocsInventory(ctx);
    const existingDocs = [...docsInventory.values()]; // Convert Map to array of doc paths

    const [diff, files] = await Promise.all([fetchPRDiff(ctx), fetchPRFiles(ctx)]);
    console.log(`📄 Found ${files.length} files (${diff.length} chars diff)\n`);

    const triage = await runTriage(files, diff.length);
    console.log(`\n📊 Triage:`, JSON.stringify(triage, null, 2), '\n');

    if (triage.files_to_audit.length === 0) {
        await postComment(ctx, formatTriageSkipComment(triage));
        return;
    }

    // AI handles doc drift detection via the prompt - now with existing docs context
    const review = await runDeepReview(triage.files_to_audit, files, diff, architectureContext, existingDocs);
    console.log(`\n🔬 Review:`, JSON.stringify(review, null, 2), '\n');

    await postComment(ctx, formatReviewComment(review));
    console.log('\n🏁 J Star Review Complete!');
}

main().catch((error) => {
    console.error('❌ J Star Reviewer crashed:', error);
    process.exit(1);
});
