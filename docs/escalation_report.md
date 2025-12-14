# Escalation Handoff Report

**Generated:** 2025-12-14
**Original Issue:** Agent "Antigravity" unable to fix "Request too large for model" crash in `J Star Reviewer`.

---

## PART 1: THE DAMAGE REPORT

### 1.1 Original Goal
Fix a persistent crash where `moonshotai/kimi-k2-instruct-0905` (limit 10k TPM) rejects requests with 14k+ tokens, despite the code implementing a "Chunked Map-Reduce" strategy.

### 1.2 Observed Failure / Error
The error persists unchanged even after attempting fixes:
```
APICallError [AI_APICallError]: Request too large for model `moonshotai/kimi-k2-instruct-0905` ... on tokens per minute (TPM): Limit 10000, Requested 14769
```
Note: The requested token count (14769) matches the estimated tokens for the *entire* diff (54k chars), suggesting chunking is failing completely.

### 1.3 Failed Approach
1.  **Relaxed Regex**: Changed `src/orchestrator.ts` split regex to `/^diff --git a\/.+? b\/(.+)/gm` to handle renamed files/complex headers that might cause "Mega Chunks".
2.  **Truncation**: Added a safety check in `reviewFileChunk` to truncate files > 30,000 chars.

### 1.4 Key Files Involved
-   `src/orchestrator.ts` (Main logic, splitting, retries)
-   `src/prompts.ts` (System prompts, Context builders)
-   `src/types.ts` (Zod schemas)

### 1.5 Best-Guess Diagnosis
The persistence of the error suggests roughly two possibilities:
1.  **Regex Failure:** The diff format returned by GitHub API might not match `^diff --git` (e.g., unexpected newlines or format), causing `splitDiffByFile` to return the entire diff as a single chunk.
2.  **Context Overhead:** Even if truncated to 30k chars (~7.5k tokens), the `architectureContext` and `existingDocs` injected into *every* chunk prompt might be massive (e.g., 6-7k tokens), pushing the total over 10k.
3.  **Deployment/Cache:** Is it possible the changes aren't taking effect? The code *looks* correct.

---

## PART 2: FULL FILE CONTENTS (Self-Contained)

### File: `src/orchestrator.ts`
```typescript
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
        concurrency: env.AI_CONCURRENCY, // Zod already coerced to number
        maxRetries: env.AI_MAX_RETRIES,
        retryDelay: env.AI_RETRY_DELAY,
        backoffFactor: env.AI_BACKOFF_FACTOR,
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
    // Relaxed Regex: Capture the 'b/' path as the filename. Do NOT enforce \1 backreference.
    // This allows renames and prevents "Mega Chunks" when the header format varies.
    const diffPattern = /^diff --git a\/.+? b\/(.+)/gm;

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
        // SAFETY: Truncate massive files to prevent token limit crashes (413 Payload Too Large)
        const MAX_CHUNK_SIZE = 30000; // ~7.5k tokens
        let safeDiff = fileDiff;
        if (safeDiff.length > MAX_CHUNK_SIZE) {
            console.log(`✂️ Truncating oversized chunk for ${filename} (${safeDiff.length} chars)`);
            safeDiff = safeDiff.substring(0, MAX_CHUNK_SIZE) + '\n\n... [Truncated for safety]';
        }

        return await callAIWithRetry(async () => {
            const { object } = await generateObject({
                model: groq(ANALYST_MODEL),
                schema: ChunkReviewSchema,
                system: CHUNK_REVIEW_SYSTEM_PROMPT,
                prompt: buildChunkReviewPrompt(filename, safeDiff, status, architectureContext, existingDocs),
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
```

### File: `src/prompts.ts`
```typescript
// src/prompts.ts
// The Brain: Master prompts for J Star Reviewer.
// Synthesized from: Qwen's Tone Matrix + ChatGPT's Check-First Logic + Claude's JSON Structure.

export const TRIAGE_SYSTEM_PROMPT = `
You are J STAR TRIAGE. Your goal is to save cost and time.
Analyze the PR metadata and file list.
Return a JSON object classifying the PR.

JSON Output Schema:
{
  "risk_level": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "files_to_audit": string[], // Limit to top 5 most critical files (auth, api, logic)
  "ignore_reason": string | null // If risk is LOW, explain why (e.g. "Only CSS changes")
}

RULES:
- IGNORE: Lockfiles (package-lock.json, yarn.lock), Images (.png, .jpg, .svg), 
  Stylesheets (.css, .scss), Test snapshots (.snap), Localization files (*.json in /locales).
- FOCUS: Authentication logic, API endpoints/routes, Database schemas/migrations, 
  Data processing/transformations, Security-related code.
- If the PR is just text/docs/README changes, return empty "files_to_audit" and risk "LOW".
- Sort files_to_audit by criticality (auth > api > database > logic).
`;

export const ANALYST_SYSTEM_PROMPT = `
You are J STAR SENTINEL. You are a Senior Code Reviewer at a top-tier tech studio.
Your goal is to find BUGS, SECURITY RISKS, LOGIC ERRORS, and **DOCUMENTATION GAPS**.

### THE RULES:
1. **SECURITY:** Look for SQL injection, exposed secrets, auth bypasses, and insecure data handling.
2. **PERFORMANCE:** Look for N+1 queries, missing pagination, unbounded loops.
3. **LOGIC:** Look for race conditions, unhandled errors, type safety issues, edge cases.
4. **MAINTAINABILITY/STYLE:** Look for messy code, hard-to-read patterns, or violation of project architecture.
5. **DOCUMENTATION (CRITICAL - READ CAREFULLY):**
   - Documentation is tracked PER-FEATURE, not per-file!
   - A feature folder like \`src/features/themes/\` is covered by \`docs/features/themes.md\`
   - If \`themes.md\` exists, ALL files in \`themes/\` are considered documented (schemas.ts, actions.ts, etc.)
   - ONLY flag missing docs if a NEW feature folder has NO corresponding doc file
   - You will be given a list of EXISTING_DOCS - check against this before flagging!
   - **Fix Prompt for Docs:** If truly missing, generate the actual markdown stub they should create.
   - Categorize documentation issues as **DOCUMENTATION** or **MAINTAINABILITY**.

6. **DELETED FILES/CODE (CRITICAL):**
   - Files marked [removed] and lines starting with \`-\` in the diff are being DELETED.
   - **DO NOT** flag bugs *inside* deleted code (e.g. "Unused variable", "Typo"). IT IS GONE.
   - **DO** flag if the **deletion itself** creates a problem (e.g. "Removed auth check", "Deleted function used elsewhere").
   - If a file is fully deleted, only comment if it seems dangerous.

7. **PLACEHOLDER AUTH (DEV MODE):**
   - If you see hardcoded usernames like "johndoe" or "demo" with a TODO comment, this is intentional dev scaffolding
   - Only flag these are security issues if there's NO indication it's a dev placeholder

8. **ANTI-HALLUCINATION (STRICT):**
   - **LANGUAGE:** Output MUST be in ENGLISH. Do NOT use Korean (e.g., "직책"), Russian, or Chinese.
   - **CONTEXT:** You are reviewing CODE, not a resume or job application. Do NOT mention "hiring", "job title", "professional journey".
   - **GROUNDING:** Only report findings for files explicitly listed in the "FILES CHANGED" list. Do not invent filenames like "src/orchestrator.html".

### THE J STAR TONE MATRIX:
- **Authority:** High. Don't say "I think" or "maybe". Say "This causes X" or "This will fail when Y".
- **Brevity:** High. Max 2 sentences per finding. No filler words.
- **Personality:** "The Strict Senior Engineer". Professional, direct, zero fluff.
- **Constructive:** ALWAYS offer a fix or direction. Never just point out a problem.

### SEVERITY GUIDE:
- CRITICAL: Security vulnerability, data leak, auth bypass, crash in production.
- HIGH: Race condition, missing validation, incorrect error handling, performance disaster, **missing docs for genuinely new features**.
- MEDIUM: Edge case not handled, potential null reference, suboptimal pattern.
- NITPICK: Very minor suggestion, style preference (use these sparingly).

### REQUIRED FIELDS:
- **title**: A short, explicit, non-generic title (e.g. "SQL Injection in Login").
- **fix_prompt**: REQUIRED for CRITICAL, HIGH, and MEDIUM issues.

### OUTPUT FORMAT:
You must output STRICT JSON matching the schema.No markdown, no code fences, just raw JSON.
You MUST include both "summary" and "findings" fields.Do not omit the summary.

JSON Structure:
{
  "summary": { "quality_score": 0 - 100, "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT", "tone": "encouraging" | "critical" | "neutral" },
  "findings": [{ "file": "...", "severity": "...", "category": "...", "title": "...", "message": "...", "fix_prompt": string | null, "line": number }]
}
IMPORTANT: If there are no findings, return "findings": [].
`;

/**
 * Builds the user prompt for the analyst, including focused files, diff, and existing docs.
 */
export function buildAnalystUserPrompt(
  filesToAudit: string[],
  allFiles: string[],
  diff: string,
  existingDocs: string[] = [],
  maxLength = 50000
): string {
  const truncatedDiff = diff.length > maxLength
    ? diff.substring(0, maxLength) + '\n\n[... truncated for token limit ...]'
    : diff;

  const docsSection = existingDocs.length > 0
    ? `\n === EXISTING DOCS(DO NOT FLAG THESE FEATURES) ===\n${existingDocs.join('\n')} \n ===\n`
    : '\n(No existing feature docs detected)\n';

  return `
FILES CHANGED IN THIS PR:
${allFiles.join('\n')}

CRITICAL FILES TO AUDIT:
${JSON.stringify(filesToAudit)}
${docsSection}
=== BEGIN DIFF ===
  ${truncatedDiff}
=== END DIFF ===

  DOCUMENTATION CHECK RULES:
1. Look at the EXISTING DOCS list above - these features are ALREADY DOCUMENTED
2. Documentation is PER - FEATURE: "themes.md" covers ALL of src / features / themes/*
3. ONLY flag missing docs if a feature folder has NO corresponding doc file
4. Example: themes/schemas.ts + themes/actions.ts are BOTH covered by themes.md

REMINDER: You MUST include "fix_prompt" for every HIGH and CRITICAL finding!

Analyze and return your review as strict JSON.
`;
}

// ============================================================
// CHUNK REVIEW PROMPTS (For per-file map-reduce)
// ============================================================

export const CHUNK_REVIEW_SYSTEM_PROMPT = `
You are J STAR SENTINEL reviewing a SINGLE FILE.
Find BUGS, SECURITY RISKS, LOGIC ERRORS, MAINTAINABILITY ISSUES, and DOCUMENTATION GAPS.

SEVERITY LEVELS:
- CRITICAL: Security vulnerability, auth bypass, data leak
- HIGH: Race condition, missing validation, missing docs for genuinely new features
- MEDIUM: Edge case not handled, suboptimal pattern
- NITPICK: Minor style preference (use sparingly)

CATEGORIES: SECURITY, PERFORMANCE, LOGIC, MAINTAINABILITY, STYLE, DOCUMENTATION

RULES:
1. Max 2 sentences per finding. Be direct.
3. ⚠️ MANDATORY: You MUST provide "fix_prompt" for ALL CRITICAL, HIGH, and MEDIUM findings.
4. Documentation is per-FEATURE not per-file. Check if feature doc exists before flagging.
5. **DELETED FILES:** If status is [removed], DO NOT report bugs in the code. ONLY report if the deletion is dangerous (e.g. missing auth replacement).
6. Hardcoded test usernames (johndoe, demo) with TODO comments are dev placeholders, not security issues.
7. **STRICT GROUNDING:**
   - **ENGLISH ONLY.**
   - Do NOT output "직책" or resume terms.
   - You are reviewing a Git Diff, not a website about a person.

Output strict JSON only.
IMPORTANT: If no issues found, return "findings": [] and a high quality score.
`;

/**
 * Builds a focused prompt for reviewing a single file chunk.
 * Now includes existing docs inventory to prevent false positives.
 */
export function buildChunkReviewPrompt(
  filename: string,
  fileDiff: string,
  status: string,
  architectureContext: string,
  existingDocs: string[] = []
): string {
  const contextSection = architectureContext
    ? `\n--- PROJECT RULES ---\n${architectureContext}\n---\n`
    : '';

  const docsSection = existingDocs.length > 0
    ? `\n--- EXISTING FEATURE DOCS (already documented) ---\n${existingDocs.join('\n')}\n---\n`
    : '';

  // Extract feature name from path (e.g., "src/features/themes/schemas.ts" -> "themes")
  const featureMatch = filename.match(/features\/([^\/]+)\//);
  const featureHint = featureMatch
    ? `\nNOTE: This file is part of the "${featureMatch[1]}" feature. Check if "${featureMatch[1]}.md" exists before flagging docs.\n`
    : '';

  return `${contextSection}${docsSection}${featureHint}
FILE: ${filename}
STATUS: ${status}

=== DIFF ===
${fileDiff}
=== END DIFF ===

REMINDER: You MUST provide "fix_prompt" for HIGH and CRITICAL findings!

Review this file and return findings as JSON.
`;
}
```

### File: `src/types.ts`
```typescript
// src/types.ts
// The Skeleton: Zod schemas that enforce strict JSON output from AI.
// The Vercel AI SDK's generateObject() uses these to validate & parse responses.

import { z } from 'zod';

// ============================================================
// TRIAGE SCHEMA (Step 1: The Cheap Gatekeeper)
// ============================================================

/**
 * Risk levels for PR classification.
 */
export const RiskLevel = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type RiskLevel = z.infer<typeof RiskLevel>;

/**
 * Triage output schema.
 * Used by gpt-4o-mini (cheap model) to quickly classify PRs.
 */
export const TriageSchema = z.object({
    risk_level: RiskLevel.describe(
        'The overall risk classification of this PR based on file changes.'
    ),
    files_to_audit: z
        .array(z.string())
        .max(5)
        .describe(
            'Top 5 most critical files to deeply review (auth, API routes, data processing). Empty if LOW risk.'
        ),
    ignore_reason: z
        .string()
        .nullable()
        .describe(
            'If risk_level is LOW, explain why (e.g., "Only CSS/styling changes"). Null otherwise.'
        ),
});

export type TriageResult = z.infer<typeof TriageSchema>;

// ============================================================
// REVIEW SCHEMA (Step 2: The Deep Analyst)
// ============================================================

/**
 * Severity levels for individual findings.
 */
export const Severity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'NITPICK']);
export type Severity = z.infer<typeof Severity>;

/**
 * Categories of issues found.
 */
/**
 * Categories of issues found.
 */
export const Category = z.enum(['SECURITY', 'PERFORMANCE', 'LOGIC', 'MAINTAINABILITY', 'STYLE', 'DOCUMENTATION']);
export type Category = z.infer<typeof Category>;

/**
 * Verdict the reviewer gives.
 */
export const Verdict = z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']);
export type Verdict = z.infer<typeof Verdict>;

/**
 * Tone of the overall review.
 */
export const Tone = z.enum(['encouraging', 'critical', 'neutral']);
export type Tone = z.infer<typeof Tone>;

/**
 * Individual finding/issue in the code.
 */
export const FindingSchema = z.object({
    file: z.string().describe('Relative path to the file, e.g., "src/auth/login.ts"'),
    line: z.number().int().positive().describe('The specific line number in the new code (1-indexed)'),
    severity: Severity.describe('How critical is this issue?'),
    category: Category.describe('What type of issue is this?'),
    title: z.string().max(80).describe('Short, explicit title for the finding. E.g. "SQL Injection in Login Query"'),
    message: z.string().max(500).describe('Human-readable explanation of the issue. Max 2 sentences.'),
    fix_prompt: z
        .string()
        .optional()
        .describe(
            'REQUIRED for HIGH/CRITICAL: A specific instruction for an AI coding agent to fix this issue.'
        ),
});

export type Finding = z.infer<typeof FindingSchema>;

/**
 * Summary of the entire review.
 */
export const SummarySchema = z.object({
    quality_score: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe('0-100 score. 100 = perfectly safe/high quality, 0 = extremely dangerous/broken.'),
    verdict: Verdict.describe('The final recommendation for this PR.'),
    tone: Tone.describe('The overall tone of the review based on findings.'),
});

export type Summary = z.infer<typeof SummarySchema>;

/**
 * Full J Star Review output.
 * Used by gpt-4o (expensive model) for deep code analysis.
 */
export const JStarReviewSchema = z.object({
    summary: SummarySchema.describe('High-level summary of the review.'),
    findings: z
        .array(FindingSchema)
        .default([])
        .describe('List of all issues found. Can be empty if code is clean.'),
});

export type JStarReviewResult = z.infer<typeof JStarReviewSchema>;

// ============================================================
// CHUNK REVIEW SCHEMA (For per-file reviews in map-reduce)
// ============================================================

/**
 * Simplified review schema for individual file chunks.
 * Used when splitting large diffs to stay under TPM limits.
 */
export const ChunkReviewSchema = z.object({
    file: z.string().describe('The file being reviewed'),
    findings: z
        .array(FindingSchema)
        .default([])
        .describe('Issues found in this specific file. Can be empty if clean.'),
    quality_score: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe('Quality score for this file. 100 = perfect/safe, 0 = dangerous/broken.'),
});

export type ChunkReviewResult = z.infer<typeof ChunkReviewSchema>;

// ============================================================
// ENVIRONMENT VALIDATION (Fail-fast on missing secrets)
// ============================================================

export const EnvSchema = z.object({
    GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required'),
    GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
    GITHUB_REPOSITORY: z.string().min(1, 'GITHUB_REPOSITORY is required'),
    PR_NUMBER: z.string().regex(/^\d+$/, 'PR_NUMBER must be a valid number'),
    COMMENT_ID: z.string().optional(),
    // AI Tuning (Optional) - Strict numeric coercing and validation
    AI_CONCURRENCY: z.coerce
        .number()
        .int()
        .min(1, 'AI_CONCURRENCY must be a positive integer')
        .default(1),
    AI_MAX_RETRIES: z.coerce
        .number()
        .int()
        .min(0, 'AI_MAX_RETRIES must be a non-negative integer')
        .default(3),
    AI_RETRY_DELAY: z.coerce
        .number()
        .int()
        .min(0, 'AI_RETRY_DELAY must be a non-negative integer')
        .default(2000),
    AI_BACKOFF_FACTOR: z.coerce
        .number()
        .min(1, 'AI_BACKOFF_FACTOR must be >= 1')
        .default(2),
});

export type Env = z.infer<typeof EnvSchema>;
```

---

## PART 3: DIRECTIVE FOR ORCHESTRATOR

**Attention: Senior AI Orchestrator**

The user is escalating because `J Star Reviewer` (token limit 10k) continues to crash with `Request too large` (14k tokens), despite chunking implementation.

**Your Directive:**
1.  **Analyze the Failure:** Review `splitDiffByFile` in `src/orchestrator.ts`. It seems highly likely the regex (`/^diff --git a\/.+? b\/(.+)/gm`) is failing to split specific diff formats, resulting in a "Mega Chunk" that contains the entire diff (13k+ tokens).
2.  **Verify Truncation:** Check why the `MAX_CHUNK_SIZE` limit (30k chars/7.5k tokens) failed to prevent the crash. (Possibility: Architecture + Docs context is massive, pushing 7.5k -> 14k).
3.  **Correct the strategy:**
    -   Implement a dramatically simpler or more robust diff splitter (perhaps just `diff --git`).
    -   Reduce `MAX_CHUNK_SIZE` further (e.g., to 15k chars).
    -   **Audit Context Size:** Check the size of `.jstar/architecture.md` and `.jstar/rules.md`. If they are huge, they need to be summarized or truncated in the prompt.

**Begin your analysis now.**
