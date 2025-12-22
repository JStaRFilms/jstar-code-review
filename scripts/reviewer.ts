import { generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import simpleGit from "simple-git";
import { Config } from "./config";
import { Detective } from "./detective";
import { GeminiEmbedding } from "./gemini-embedding";
import { MockLLM } from "./mock-llm";
import { FileFinding, DashboardReport, LLMReviewResponse, EMPTY_REVIEW } from "./types";
import { renderDashboard, determineStatus, generateRecommendation } from "./dashboard";
import {
    VectorStoreIndex,
    storageContextFromDefaults,
    MetadataMode,
    serviceContextFromDefaults
} from "llamaindex";

const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const google = createGoogleGenerativeAI({ apiKey: geminiKey });
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

const embedModel = new GeminiEmbedding();
const llm = new MockLLM();
const serviceContext = serviceContextFromDefaults({ embedModel, llm: llm as any });

const STORAGE_DIR = path.join(process.cwd(), ".jstar", "storage");
const SOURCE_DIR = path.join(process.cwd(), "scripts");
const OUTPUT_FILE = path.join(process.cwd(), ".jstar", "last-review.md");
const git = simpleGit();

// --- Config ---
const MODEL_NAME = Config.MODEL_NAME;
const MAX_TOKENS_PER_REQUEST = 8000;
const CHARS_PER_TOKEN = 4;
const DELAY_BETWEEN_CHUNKS_MS = 2000;

// --- Helpers ---
function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const EXCLUDED_PATTERNS = [
    /pnpm-lock\.yaml/,
    /package-lock\.json/,
    /yarn\.lock/,
    /\.env/,
    /\.json$/,
    /\.txt$/,
    /\.md$/,
    /node_modules/,
    /\.jstar\//,
];

function shouldSkipFile(fileName: string): boolean {
    return EXCLUDED_PATTERNS.some(pattern => pattern.test(fileName));
}

function chunkDiffByFile(diff: string): string[] {
    return diff.split(/(?=^diff --git)/gm).filter(Boolean);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseReviewResponse(text: string): LLMReviewResponse {
    try {
        // Try to extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);

            // Validate structure
            if (
                parsed &&
                typeof parsed === 'object' &&
                Array.isArray(parsed.issues) &&
                ['P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'LGTM'].includes(parsed.severity)
            ) {
                return {
                    severity: parsed.severity,
                    issues: parsed.issues
                };
            }
        }
    } catch (e) {
        // Parse failed, try to extract from markdown
    }

    // Fallback: If "LGTM" in text, it's clean
    if (text.includes('LGTM') || text.includes('✅')) {
        return { severity: 'LGTM', issues: [] };
    }

    // Otherwise, assume there are issues (treat as medium)
    return {
        severity: Config.DEFAULT_SEVERITY,
        issues: [{
            title: 'Review Notes',
            description: text.slice(0, 500),
            fixPrompt: 'Review the file and address the issues mentioned above.'
        }]
    };
}

// --- Main ---
async function main() {
    console.log(chalk.blue("🕵️  J-Star Reviewer: Analyzing your changes...\n"));

    // 0. Environment Validation
    if (!geminiKey || !process.env.GROQ_API_KEY) {
        console.error(chalk.red("❌ Missing API Keys!"));
        console.log(chalk.yellow("\nPlease ensure you have a .env.local file with:"));
        console.log(chalk.white("- GEMINI_API_KEY (or GOOGLE_API_KEY)"));
        console.log(chalk.white("- GROQ_API_KEY"));
        console.log(chalk.white("\nCheck .env.example for a template.\n"));
        return;
    }

    // 1. Detective
    console.log(chalk.blue("🔎 Running Detective Engine..."));

    const detective = new Detective(SOURCE_DIR);
    await detective.scan();
    detective.report();

    // 1. Get the Diff
    const diff = await git.diff(["--staged"]);
    if (!diff) {
        console.log(chalk.green("\n✅ No staged changes to review. (Did you 'git add'?)"));
        return;
    }

    // 2. Load the Brain
    if (!fs.existsSync(STORAGE_DIR)) {
        console.error(chalk.red("❌ Local Brain not found. Run 'pnpm run index:init' first."));
        return;
    }
    const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });
    const index = await VectorStoreIndex.init({ storageContext, serviceContext });

    // 3. Retrieval
    const retriever = index.asRetriever({ similarityTopK: 1 });
    const keywords = (diff.match(/import .* from ['"](.*)['"]/g) || [])
        .map(s => s.replace(/import .* from ['"](.*)['"]/, '$1'))
        .join(" ").slice(0, 300) || "general context";
    const contextNodes = await retriever.retrieve(keywords);
    const relatedContext = contextNodes.map(n => n.node.getContent(MetadataMode.NONE).slice(0, 1500)).join("\n");

    console.log(chalk.yellow(`\n🧠 Found ${contextNodes.length} context chunk.`));

    // 4. Chunk the Diff
    const fileChunks = chunkDiffByFile(diff);
    const totalTokens = estimateTokens(diff);
    console.log(chalk.dim(`   Total diff: ~${totalTokens} tokens across ${fileChunks.length} files.`));

    // 5. Structured JSON Prompt
    const systemPrompt = `You are J-Star, a Senior Code Reviewer. Be direct and professional.

Analyze the Git Diff and return a JSON response with this EXACT structure:
{
  "severity": "P0_CRITICAL" | "P1_HIGH" | "P2_MEDIUM" | "LGTM",
  "issues": [
    {
      "title": "Short issue title",
      "description": "Detailed description of the problem",
      "line": 42,
      "fixPrompt": "A specific prompt an AI can use to fix this issue"
    }
  ]
}

SEVERITY GUIDE:
- P0_CRITICAL: Security vulnerabilities, data leaks, auth bypass, SQL injection
- P1_HIGH: Missing validation, race conditions, architectural violations
- P2_MEDIUM: Code quality, missing types, cleanup needed
- LGTM: No issues found (return empty issues array)

IMPORTANT: 
- Return ONLY valid JSON, no markdown or explanation
- Each issue MUST have a fixPrompt that explains exactly how to fix it
- If the file is clean, return {"severity": "LGTM", "issues": []}

Context: ${relatedContext.slice(0, 800)}`;

    const findings: FileFinding[] = [];
    let chunkIndex = 0;
    let skippedCount = 0;

    console.log(chalk.blue("\n⚖️  Sending to Judge...\n"));

    for (const chunk of fileChunks) {
        chunkIndex++;
        const fileName = chunk.match(/diff --git a\/(.+?) /)?.[1] || `Chunk ${chunkIndex}`;

        // Skip excluded files
        if (shouldSkipFile(fileName)) {
            console.log(chalk.dim(`   ⏭️  Skipping ${fileName} (excluded)`));
            skippedCount++;
            continue;
        }

        const chunkTokens = estimateTokens(chunk) + estimateTokens(systemPrompt);

        // Skip huge files
        if (chunkTokens > MAX_TOKENS_PER_REQUEST) {
            console.log(chalk.yellow(`   ⚠️  Skipping ${fileName} (too large: ~${chunkTokens} tokens)`));
            findings.push({
                file: fileName,
                severity: Config.DEFAULT_SEVERITY,
                issues: [{
                    title: 'File too large for review',
                    description: `This file has ~${chunkTokens} tokens which exceeds the limit.`,
                    fixPrompt: 'Consider splitting this file into smaller modules.'
                }]
            });
            continue;
        }

        process.stdout.write(chalk.dim(`   📄 ${fileName}...`));

        try {
            const { text } = await generateText({
                model: groq(MODEL_NAME),
                system: systemPrompt,
                prompt: `REVIEW THIS DIFF:\n\n${chunk}`,
                temperature: 0.1,
            });

            const response = parseReviewResponse(text);
            findings.push({
                file: fileName,
                severity: response.severity,
                issues: response.issues
            });

            const emoji = response.severity === 'LGTM' ? '✅' :
                response.severity === 'P0_CRITICAL' ? '🛑' :
                    response.severity === 'P1_HIGH' ? '⚠️' : '📝';
            console.log(` ${emoji}`);

        } catch (error: any) {
            console.log(chalk.red(` ❌ (${error.message.slice(0, 50)})`));
            findings.push({
                file: fileName,
                severity: Config.DEFAULT_SEVERITY,
                issues: [{
                    title: 'Review failed',
                    description: error.message,
                    fixPrompt: 'Retry the review or check manually.'
                }]
            });
        }

        // Rate limit delay
        if (chunkIndex < fileChunks.length) {
            await sleep(DELAY_BETWEEN_CHUNKS_MS);
        }
    }

    // 6. Build Dashboard Report
    const metrics = {
        filesScanned: fileChunks.length - skippedCount,
        totalTokens,
        violations: findings.reduce((sum, f) => sum + f.issues.length, 0),
        critical: findings.filter(f => f.severity === 'P0_CRITICAL').length,
        high: findings.filter(f => f.severity === 'P1_HIGH').length,
        medium: findings.filter(f => f.severity === 'P2_MEDIUM').length,
        lgtm: findings.filter(f => f.severity === 'LGTM').length,
    };

    const report: DashboardReport = {
        date: new Date().toISOString().split('T')[0],
        reviewer: 'Detective Engine & Judge',
        status: determineStatus(metrics),
        metrics,
        findings,
        recommendedAction: generateRecommendation(metrics)
    };

    // 7. Render and Save Dashboard
    const dashboard = renderDashboard(report);

    // Ensure .jstar directory exists
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, dashboard);

    console.log("\n" + chalk.bold.green("📊 DASHBOARD GENERATED"));
    console.log(chalk.dim(`   Saved to: ${OUTPUT_FILE}`));
    console.log("\n" + chalk.bold.white("─".repeat(50)));

    // Print summary to console
    const statusEmoji = report.status === 'APPROVED' ? '🟢' :
        report.status === 'NEEDS_REVIEW' ? '🟡' : '🔴';
    console.log(`\n${statusEmoji} Status: ${report.status.replace('_', ' ')}`);
    console.log(`   🛑 Critical: ${metrics.critical}`);
    console.log(`   ⚠️  High: ${metrics.high}`);
    console.log(`   📝 Medium: ${metrics.medium}`);
    console.log(`   ✅ LGTM: ${metrics.lgtm}`);
    console.log(`\n💡 ${report.recommendedAction}`);
    console.log(chalk.dim(`\n📄 Full report: ${OUTPUT_FILE}`));
}

main().catch(console.error);
