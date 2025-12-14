// src/orchestrator.ts
// The Runner: J Star Code Review Orchestrator
// Lean version: ~200 lines. No regex. Pure AI reasoning.

import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { Octokit } from '@octokit/rest';
import {
    TRIAGE_SYSTEM_PROMPT,
    ANALYST_SYSTEM_PROMPT,
    buildAnalystUserPrompt,
    CHUNK_REVIEW_SYSTEM_PROMPT,
    buildChunkReviewPrompt
} from './prompts.js';
import {
    TriageSchema,
    JStarReviewSchema,
    ChunkReviewSchema,
    EnvSchema,
    type TriageResult,
    type JStarReviewResult,
    type ChunkReviewResult,
    type Finding,
    type Env,
} from './types.js';

// Initialize Groq provider
const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY,
});

// Model configuration from env
const TRIAGE_MODEL = process.env.TRIAGE_MODEL || 'openai/gpt-oss-120b';
const ANALYST_MODEL = process.env.ANALYST_MODEL || 'moonshotai/kimi-k2-instruct-0905';

// ============================================================
// ENVIRONMENT & CONFIG
// ============================================================

interface AIConfig {
    concurrency: number;
    maxRetries: number;
    retryDelay: number;
    backoffFactor: number;
}

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

function parseAIConfig(env: Env): AIConfig {
    return {
        concurrency: parseInt(env.AI_CONCURRENCY || '1', 10),
        maxRetries: parseInt(env.AI_MAX_RETRIES || '3', 10),
        retryDelay: parseInt(env.AI_RETRY_DELAY || '2000', 10),
        backoffFactor: parseInt(env.AI_BACKOFF_FACTOR || '2', 10),
    };
}

interface GitHubContext {
    owner: string;
    repo: string;
    prNumber: number;
    commentId?: number;
    octokit: Octokit;
    config: AIConfig; // Pass AI config through context
}

interface PrFile {
    filename: string;
    status: 'added' | 'modified' | 'removed' | 'renamed' | 'changed' | 'copied' | 'unchanged';
}

function initGitHub(env: Env, config: AIConfig): GitHubContext {
    const [owner, repo] = env.GITHUB_REPOSITORY.split('/');
    return {
        owner,
        repo,
        prNumber: parseInt(env.PR_NUMBER, 10),
        commentId: env.COMMENT_ID ? parseInt(env.COMMENT_ID, 10) : undefined,
        octokit: new Octokit({ auth: env.GITHUB_TOKEN }),
        config,
    };
}

// ============================================================
// REMOTE CONTEXT LOADING (GitHub API)
// ============================================================

async function fetchRemoteFile(ctx: GitHubContext, path: string): Promise<string | null> {
    try {
        const { data } = await ctx.octokit.repos.getContent({
            owner: ctx.owner,
            repo: ctx.repo,
            path: path,
        });

        if (Array.isArray(data) || !('content' in data)) {
            return null;
        }

        return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (e: any) {
        if (e.status !== 404) {
            console.log(`⚠️ Error fetching ${path}: ${e.message}`);
        }
        return null;
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

async function loadDocsInventory(ctx: GitHubContext): Promise<Map<string, string>> {
    const inventory = new Map<string, string>();
    const targetDirs = ['docs/features'];

    for (const docsDir of targetDirs) {
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

    const data = response.data;
    if (typeof data === 'string') {
        return data;
    }

    console.warn('⚠️ Unexpected diff format:', typeof data);
    return String(data || '');
}

async function fetchPRFiles(ctx: GitHubContext): Promise<PrFile[]> {
    const response = await ctx.octokit.pulls.listFiles({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.prNumber,
        per_page: 100,
    });
    return response.data.map((file) => ({
        filename: file.filename,
        status: file.status as PrFile['status']
    }));
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

async function addReaction(ctx: GitHubContext, reaction: 'eyes' | 'rocket' | 'confused') {
    try {
        if (ctx.commentId) {
            await ctx.octokit.reactions.createForIssueComment({
                owner: ctx.owner,
                repo: ctx.repo,
                comment_id: ctx.commentId,
                content: reaction,
            });
            console.log(`👀 Reacted to comment with ${reaction}`);
        } else {
            await ctx.octokit.reactions.createForIssue({
                owner: ctx.owner,
                repo: ctx.repo,
                issue_number: ctx.prNumber,
                content: reaction,
            });
            console.log(`👀 Reacted to PR with ${reaction}`);
        }
    } catch (e) {
        console.error("⚠️ Could not react:", e);
    }
}

// ============================================================
// GLOBAL HELPERS
// ============================================================

/**
 * Helper: Retry AI calls with exponential backoff on rate limits.
 */
async function callAIWithRetry<T>(operation: () => Promise<T>, config: AIConfig, retriesOverride?: number, delayOverride?: number): Promise<T> {
    const retries = retriesOverride ?? config.maxRetries;
    const delay = delayOverride ?? config.retryDelay;

    try {
        return await operation();
    } catch (error: any) {
        const code = error.code || '';
        const status = error.statusCode || 0;

        const isRateLimit =
            status === 429 ||
            code === 'rate_limit_exceeded' ||
            code === 'insufficient_quota' ||
            error.message?.toLowerCase().includes('rate limit') ||
            error.message?.toLowerCase().includes('token');

        if (retries > 0 && isRateLimit) {
            console.log(`   🔸 Rate limit hit (${status || code}). Retrying in ${delay / 1000}s... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            // RECURSIVE AWAIT FIX (Audit Item 1)
            return await callAIWithRetry(operation, config, retries - 1, delay * config.backoffFactor);
        }
        throw error;
    }
}

// ============================================================
// AI STAGES
// ============================================================

async function runTriage(files: PrFile[], diffLength: number): Promise<TriageResult> {
    console.log(`🔍 Running Triage with ${TRIAGE_MODEL}...`);

    const fileList = files.map(f => `${f.filename} [${f.status}]`).join('\n');

    const { object } = await generateObject({
        model: groq(TRIAGE_MODEL),
        schema: TriageSchema,
        system: TRIAGE_SYSTEM_PROMPT,
        prompt: `PR contains ${files.length} files. Diff length: ${diffLength} chars.\n\nFiles:\n${fileList}`,
    });

    return object;
}

async function runDeepReview(filesToAudit: string[], allFiles: PrFile[], diff: string, architectureContext: string, existingDocs: string[], config: AIConfig): Promise<JStarReviewResult> {
    console.log(`🧠 Running Deep Review with ${ANALYST_MODEL}...`);

    // Estimate tokens (rough: 4 chars per token)
    const estimatedTokens = Math.ceil(diff.length / 4);

    // TOKEN LIMIT RATIONALE (Audit Item 2)
    // We reduce this to 6000 to leave a safe buffer for 120b or Kimi models which often have
    // 8k-10k TPM limits on lower tiers.
    const TOKEN_LIMIT = 6000;

    if (estimatedTokens <= TOKEN_LIMIT) {
        const rawResult = await runSingleShotReview(filesToAudit, allFiles, diff, architectureContext, existingDocs, config);
        return adjustScoreForSkippedFiles(rawResult, filesToAudit.length, allFiles.length);
    }

    console.log(`📦 Diff too large (${estimatedTokens} est. tokens), using chunked review`);
    const rawResult = await runChunkedReview(filesToAudit, allFiles, diff, architectureContext, existingDocs, config);
    return adjustScoreForSkippedFiles(rawResult, filesToAudit.length, allFiles.length);
}

function adjustScoreForSkippedFiles(result: JStarReviewResult, auditedCount: number, totalCount: number): JStarReviewResult {
    if (totalCount === 0) return result;

    const effectiveAudited = Math.min(auditedCount, totalCount);
    const skippedCount = totalCount - effectiveAudited;

    if (skippedCount <= 0) return result;

    const currentScore = result.summary.quality_score;
    const weightedScore = Math.round(
        ((currentScore * effectiveAudited) + (100 * skippedCount)) / totalCount
    );

    console.log(`⚖️  Weighted Score Adjustment:`);
    console.log(`    - Raw Score: ${currentScore}, Audited: ${effectiveAudited}`);
    console.log(`    - Skipped (100): ${skippedCount}`);
    console.log(`    - New Score: ${weightedScore}`);

    return {
        ...result,
        summary: {
            ...result.summary,
            quality_score: weightedScore
        }
    };
}

async function runSingleShotReview(filesToAudit: string[], allFiles: PrFile[], diff: string, architectureContext: string, existingDocs: string[], config: AIConfig): Promise<JStarReviewResult> {
    const enhancedSystemPrompt = architectureContext
        ? `${ANALYST_SYSTEM_PROMPT}\n\n--- PROJECT CONTEXT ---\n${architectureContext}`
        : ANALYST_SYSTEM_PROMPT;

    const formattedFiles = allFiles.map(f => `${f.filename} [${f.status}]`);

    const { object } = await callAIWithRetry(async () => {
        return await generateObject({
            model: groq(ANALYST_MODEL),
            schema: JStarReviewSchema,
            system: enhancedSystemPrompt,
            prompt: buildAnalystUserPrompt(filesToAudit, formattedFiles, diff, existingDocs),
        });
    }, config);

    return object;
}

// ============================================================
// CHUNKED MAP-REDUCE REVIEW
// ============================================================

interface FileDiff {
    filename: string;
    diff: string;
}

function splitDiffByFile(diff: string): FileDiff[] {
    const fileDiffs: FileDiff[] = [];
    const diffPattern = /^diff --git a\/(.+?) b\/\1/gm;

    let match;
    const positions: { filename: string; start: number }[] = [];

    while ((match = diffPattern.exec(diff)) !== null) {
        positions.push({ filename: match[1], start: match.index });
    }

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

async function runChunkedReview(filesToAudit: string[], allFiles: PrFile[], diff: string, architectureContext: string, existingDocs: string[], config: AIConfig): Promise<JStarReviewResult> {
    const fileDiffs = splitDiffByFile(diff);
    console.log(`🔪 Split into ${fileDiffs.length} file chunks`);

    const relevantDiffs = fileDiffs.filter(fd =>
        filesToAudit.some(f => fd.filename.endsWith(f) || f.endsWith(fd.filename))
    );

    console.log(`🎯 Reviewing ${relevantDiffs.length} critical files`);

    const BATCH_SIZE = config.concurrency;
    const allChunkResults: ChunkReviewResult[] = [];

    for (let i = 0; i < relevantDiffs.length; i += BATCH_SIZE) {
        const batch = relevantDiffs.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(fd => {
                const fileInfo = allFiles.find(f => f.filename === fd.filename);
                const status = fileInfo?.status || 'modified';
                return reviewFileChunk(fd.filename, fd.diff, status, architectureContext, existingDocs, config);
            })
        );
        allChunkResults.push(...batchResults);

        // DELAY OPTIMIZATION (Audit Item 3)
        // Only delay if we have more files to process AND we are running in strict sequential mode (low tier).
        // High concurrency tiers (3+) likely don't need this artificial delay as much, or the throughput matters more.
        if (i + BATCH_SIZE < relevantDiffs.length && config.concurrency === 1) {
            console.log(`   ⏳ Reviewed ${i + BATCH_SIZE}/${relevantDiffs.length} files... taking a breath 🧘`);
            await new Promise(resolve => setTimeout(resolve, config.retryDelay));
        }
    }

    return aggregateChunkReviews(allChunkResults);
}

async function reviewFileChunk(filename: string, fileDiff: string, status: string, architectureContext: string, existingDocs: string[], config: AIConfig): Promise<ChunkReviewResult> {
    try {
        return await callAIWithRetry(async () => {
            const { object } = await generateObject({
                model: groq(ANALYST_MODEL),
                schema: ChunkReviewSchema,
                system: CHUNK_REVIEW_SYSTEM_PROMPT,
                prompt: buildChunkReviewPrompt(filename, fileDiff, status, architectureContext, existingDocs),
            });
            return object;
        }, config);
    } catch (error) {
        console.log(`⚠️ Failed to review ${filename} after retries, skipping. Error: ${(error as any).message}`);
        return { file: filename, findings: [], quality_score: 0 };
    }
}

function aggregateChunkReviews(chunks: ChunkReviewResult[]): JStarReviewResult {
    const allFindings: Finding[] = [];
    let totalQuality = 0;

    for (const chunk of chunks) {
        allFindings.push(...chunk.findings);
        totalQuality += chunk.quality_score;
    }

    const avgQuality = chunks.length > 0 ? Math.round(totalQuality / chunks.length) : 0;

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
// FORMATTING (Skipped detailed changes, kept as is)
// ============================================================

function formatTriageSkipComment(triage: TriageResult): string {
    return `## ✨ J Star Triage\n\n**Risk Level:** ${triage.risk_level}\n\n${triage.ignore_reason ? `> ${triage.ignore_reason}` : ''}\n\nNo critical files detected. Skipping deep review. 🎉`;
}

function formatReviewComment(review: JStarReviewResult): string {
    const score = review.summary.quality_score;
    const verdict = review.summary.verdict;

    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, NITPICK: 0 };
    for (const f of review.findings) counts[f.severity]++;
    const totalFindings = review.findings.length;

    // High-Density Mode if >= 30 findings
    const isHighDensity = totalFindings >= 30;

    const icon = score > 80 ? '🟢' : score > 50 ? '🟡' : '🔴';
    let md = `# ${icon} J Star Code Audit\n\n`;

    md += `| Score | Verdict | 🚨 Critical | 🔶 High | 🔹 Medium | 🔧 Nitpick |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    md += `| **${score}/100** | **${verdict}** | ${counts.CRITICAL || '-'} | ${counts.HIGH || '-'} | ${counts.MEDIUM || '-'} | ${counts.NITPICK || '-'} |\n\n`;

    if (totalFindings === 0) {
        md += `### ✨ No issues found. Ship it!\n\n---\n\nPowered by J Star Sentinel ⚡`;
        return md;
    }

    const byFile = new Map<string, Finding[]>();
    for (const f of review.findings) {
        if (!byFile.has(f.file)) byFile.set(f.file, []);
        byFile.get(f.file)!.push(f);
    }

    const sevIcons: Record<string, string> = { CRITICAL: '🚨', HIGH: '🔶', MEDIUM: '🔹', NITPICK: '🔧' };

    if (isHighDensity) {
        md += `**SUMMARY MODE** (High finding count detected)\n\n`;
        for (const [file, findings] of byFile) {
            md += `### 📄 ${file}\n\n`;
            md += `| Sev | Cat | Issue | Fix |\n`;
            md += `| :--- | :--- | :--- | :--- |\n`;
            for (const f of findings) {
                const title = f.title || f.message.substring(0, 50);
                const desc = f.message;
                const fix = f.fix_prompt ? `\`${f.fix_prompt.substring(0, 50)}${f.fix_prompt.length > 50 ? '...' : ''}\`` : 'See comments';
                md += `| ${sevIcons[f.severity]} | ${f.category} | **${title}**<br>${desc} | ${fix} |\n`;
            }
            md += `\n`;
        }
    } else {
        for (const [file, findings] of byFile) {
            md += `## 📄 ${file}\n\n`;
            const fixes: string[] = [];
            for (const f of findings) {
                const title = f.title || 'Untitled Issue';
                const isAlertAndCritical = f.severity === 'CRITICAL';
                const isAlertAndHigh = f.severity === 'HIGH';

                if (f.fix_prompt) fixes.push(`**${title}**: ${f.fix_prompt}`);

                if (isAlertAndCritical || isAlertAndHigh) {
                    const alertType = isAlertAndCritical ? 'CAUTION' : 'WARNING';
                    md += `> [!${alertType}]\n> **${title}**\n> ${f.message}\n\n`;
                } else {
                    md += `### ${sevIcons[f.severity]} ${title}\n**Category:** ${f.category}\n\n${f.message}\n\n`;
                }
            }
            if (fixes.length > 0) {
                md += `**🛠️ Recommended Fixes**\n\n`;
                for (const fix of fixes) md += `- ${fix}\n`;
            }
            md += `\n---\n\n`;
        }
    }

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
    const config = parseAIConfig(env);
    const ctx = initGitHub(env, config);

    await addReaction(ctx, 'eyes');

    console.log(`📦 Reviewing PR #${ctx.prNumber} in ${ctx.owner}/${ctx.repo}\n`);

    const architectureContext = await loadArchitectureContext(ctx);
    const docsInventory = await loadDocsInventory(ctx);
    const existingDocs = [...docsInventory.values()];

    const [diff, files] = await Promise.all([fetchPRDiff(ctx), fetchPRFiles(ctx)]);
    console.log(`📄 Found ${files.length} files (${diff.length} chars diff)\n`);

    const triage = await runTriage(files, diff.length);
    console.log(`\n📊 Triage:`, JSON.stringify(triage, null, 2), '\n');

    if (triage.files_to_audit.length === 0) {
        await postComment(ctx, formatTriageSkipComment(triage));
        await addReaction(ctx, 'rocket');
        return;
    }

    const review = await runDeepReview(triage.files_to_audit, files, diff, architectureContext, existingDocs, config);
    console.log(`\n🔬 Review:`, JSON.stringify(review, null, 2), '\n');

    await postComment(ctx, formatReviewComment(review));

    const finalReaction = review?.summary?.verdict === 'REQUEST_CHANGES' ? 'confused' : 'rocket';
    await addReaction(ctx, finalReaction);

    console.log('\n🏁 J Star Review Complete!');
}

main().catch((error) => {
    console.error('❌ J Star Reviewer crashed:', error);
    process.exit(1);
});
