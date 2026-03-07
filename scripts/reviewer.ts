import { generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import simpleGit from "simple-git";
import {
    VectorStoreIndex,
    storageContextFromDefaults,
    MetadataMode,
    serviceContextFromDefaults,
} from "llamaindex";
import { Logger } from "./utils/logger";
import { Config } from "./config";
import { GeminiEmbedding } from "./gemini-embedding";
import { MockLLM } from "./mock-llm";
import { DashboardReport, FileFinding, LLMReviewResponse, ReviewIssue, Severity } from "./types";
import { renderDashboard, determineStatus, generateRecommendation } from "./dashboard";
import { startInteractiveSession } from "./session";
import { critiqueFindings } from "./core/critique";
import { mapAuditSeverityToReviewSeverity, runDeterministicAudit } from "./core/deterministic-audit";
import { mergeFindings, severityMax } from "./core/review-findings";
import { chunkDiffByFile, extractDiffFileNames, resolveReviewTarget } from "./core/review-target";
import { shouldSkipReviewFile } from "./core/project";

const geminiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

const embedModel = new GeminiEmbedding();
const llm = new MockLLM();
const serviceContext = serviceContextFromDefaults({ embedModel, llm: llm as any });

const STORAGE_DIR = path.join(process.cwd(), ".jstar", "storage");
const OUTPUT_FILE = path.join(process.cwd(), ".jstar", "last-review.md");
const SESSION_FILE = path.join(process.cwd(), ".jstar", "session.json");
const git = simpleGit();

const MODEL_NAME = Config.MODEL_NAME;
const MAX_TOKENS_PER_REQUEST = 8000;
const CHARS_PER_TOKEN = 4;
const DELAY_BETWEEN_CHUNKS_MS = 2000;

function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterByConfidence(findings: FileFinding[]): FileFinding[] {
    const threshold = Config.CONFIDENCE_THRESHOLD;
    let removedCount = 0;

    const filtered = findings.map((finding) => {
        const validIssues = finding.issues.filter((issue) => {
            const confidence = issue.confidenceScore ?? 5;
            if (confidence < threshold) {
                removedCount++;
                Logger.info(chalk.dim(`   ⚡ Low confidence (${confidence}): "${issue.title}" - filtered out`));
                return false;
            }
            return true;
        });

        return {
            ...finding,
            issues: validIssues,
            severity: validIssues.length === 0 ? "LGTM" as const : finding.severity,
        };
    });

    if (removedCount > 0) {
        Logger.info(chalk.blue(`\n   📊 Confidence Filter: ${removedCount} low-confidence issue(s) removed\n`));
    }

    return filtered;
}

function parseReviewResponse(text: string): LLMReviewResponse {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (
                parsed &&
                typeof parsed === "object" &&
                Array.isArray(parsed.issues) &&
                ["P0_CRITICAL", "P1_HIGH", "P2_MEDIUM", "LGTM"].includes(parsed.severity)
            ) {
                return {
                    severity: parsed.severity,
                    issues: parsed.issues,
                };
            }
        }
    } catch {
        // Fall back to conservative parsing below.
    }

    if (text.includes("LGTM") || text.includes("✅")) {
        return { severity: "LGTM", issues: [] };
    }

    return {
        severity: Config.DEFAULT_SEVERITY,
        issues: [
            {
                title: "Review Notes",
                description: text.slice(0, 500),
                fixPrompt: "Review the file and address the issues mentioned above.",
            },
        ],
    };
}

function groupDeterministicFindings(findings: Awaited<ReturnType<typeof runDeterministicAudit>>["findings"]): FileFinding[] {
    const grouped = new Map<string, FileFinding>();

    findings.forEach((finding) => {
        const reviewIssue: ReviewIssue = {
            title: `[${finding.ruleId}] ${finding.title}`,
            description: finding.message,
            line: finding.line,
            fixPrompt: finding.recommendation,
            confidenceScore: 5,
            ruleId: finding.ruleId,
            source: "deterministic",
        };

        const severity = mapAuditSeverityToReviewSeverity(finding.severity);
        const existing = grouped.get(finding.file);
        if (!existing) {
            grouped.set(finding.file, {
                file: finding.file,
                severity,
                issues: [reviewIssue],
            });
            return;
        }

        existing.issues.push(reviewIssue);
        existing.severity = severityMax(existing.severity, severity);
    });

    return [...grouped.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function logDeterministicSummary(report: Awaited<ReturnType<typeof runDeterministicAudit>>) {
    if (report.findings.length === 0) {
        Logger.info(chalk.green("✅ Deterministic Security Pass: No findings in the review scope."));
        return;
    }

    Logger.info(
        chalk.red(
            `🚨 Deterministic Security Pass: ${report.summary.critical} critical, ${report.summary.high} high, ${report.summary.warning} warning.`,
        ),
    );

    report.findings.slice(0, 10).forEach((finding) => {
        const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
        Logger.info(chalk.yellow(`   [${finding.ruleId}] ${location} - ${finding.title}`));
    });

    if (report.findings.length > 10) {
        Logger.dim(`... and ${report.findings.length - 10} more deterministic finding(s).`);
    }
}

async function main() {
    Logger.init();

    Logger.info(chalk.blue("🕵️  J-Star Reviewer: Analyzing your changes...\n"));

    if (!geminiKey || !process.env.GROQ_API_KEY) {
        Logger.error("❌ Missing API Keys!");
        Logger.info(chalk.yellow("\nPlease ensure you have a .env.local file with:"));
        Logger.info(chalk.white("- GEMINI_API_KEY (or GOOGLE_API_KEY)"));
        Logger.info(chalk.white("- GROQ_API_KEY"));
        Logger.info(chalk.white("\nCheck .env.example for a template.\n"));
        return;
    }

    const args = process.argv.slice(2);
    let target;
    try {
        target = await resolveReviewTarget(git, args);
    } catch (error: any) {
        Logger.error(`❌ ${error.message}`);
        return;
    }

    if (!target.diff) {
        if (target.label === "Staged Changes") {
            Logger.info(chalk.green("\n✅ No staged changes to review. (Did you 'git add'?)"));
            Logger.info(chalk.dim("   Tip: Use '--last' to review the previous commit."));
        } else {
            Logger.info(chalk.green(`\n✅ No changes found in ${target.label}.`));
        }
        return;
    }

    Logger.info(chalk.blue(`\n📝 Reviewing: ${target.label}`));

    const changedFiles = extractDiffFileNames(target.diff)
        .map((filePath) => path.resolve(process.cwd(), filePath))
        .filter((filePath) => fs.existsSync(filePath));

    const deterministicReport = await runDeterministicAudit({
        mode: "REVIEW_SCAN",
        target: target.label,
        filePaths: changedFiles,
        includeRepositoryChecks: false,
    });
    logDeterministicSummary(deterministicReport);

    if (!fs.existsSync(STORAGE_DIR)) {
        Logger.error(chalk.red("❌ Local Brain not found. Run 'pnpm run index:init' first."));
        return;
    }

    const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });
    const index = await VectorStoreIndex.init({ storageContext, serviceContext });

    const retriever = index.asRetriever({ similarityTopK: 1 });
    const keywords =
        (target.diff.match(/import .* from ['"](.*)['"]/g) || [])
            .map((statement) => statement.replace(/import .* from ['"](.*)['"]/, "$1"))
            .join(" ")
            .slice(0, 300) || "general context";
    const contextNodes = await retriever.retrieve(keywords);
    const relatedContext = contextNodes
        .map((node) => node.node.getContent(MetadataMode.NONE).slice(0, 1500))
        .join("\n");

    Logger.info(chalk.yellow(`\n🧠 Found ${contextNodes.length} context chunk.`));

    const fileChunks = chunkDiffByFile(target.diff);
    const totalTokens = estimateTokens(target.diff);
    Logger.info(chalk.dim(`   Total diff: ~${totalTokens} tokens across ${fileChunks.length} files.`));

    const systemPrompt = `You are J-Star, a Senior Code Reviewer. Be CONSERVATIVE and PRECISE.

Analyze the Git Diff and return a JSON response with this EXACT structure:
{
  "severity": "P0_CRITICAL" | "P1_HIGH" | "P2_MEDIUM" | "LGTM",
  "issues": [
    {
      "title": "Short issue title",
      "description": "Detailed description of the problem",
      "line": 42,
      "fixPrompt": "A specific prompt an AI can use to fix this issue",
      "confidenceScore": 5
    }
  ]
}

SEVERITY GUIDE:
- P0_CRITICAL: Security vulnerabilities, data leaks, auth bypass, SQL injection
- P1_HIGH: Missing validation, race conditions, architectural violations
- P2_MEDIUM: Code quality, missing types, cleanup needed
- LGTM: No issues found (return empty issues array)

CONFIDENCE SCORE (1-5) - BE HONEST:
- 5: Absolutely certain. The bug is obvious in the diff.
- 4: Very likely. Clear code smell or anti-pattern.
- 3: Probable issue, might be missing context.
- 2: Unsure, could be intentional.
- 1: Speculation, likely false positive.

CRITICAL RULES:
1. Only flag issues you are HIGHLY confident about (4-5).
2. Test mocks, stubs, and intentional patterns are NOT bugs.
3. If the code looks intentional or well-handled, it's probably fine.
4. When in doubt, lean towards LGTM.
5. Return ONLY valid JSON, no markdown.
6. If the file is clean: {"severity": "LGTM", "issues": []}

Context: ${relatedContext.slice(0, 800)}`;

    const llmFindings: FileFinding[] = [];
    let chunkIndex = 0;
    let skippedCount = 0;

    Logger.info(chalk.blue("\n⚖️  Sending to Judge...\n"));

    for (const chunk of fileChunks) {
        chunkIndex++;
        const fileName = chunk.match(/diff --git a\/(.+?) /)?.[1] || `Chunk ${chunkIndex}`;

        if (shouldSkipReviewFile(fileName)) {
            Logger.info(chalk.dim(`   ⏭️  Skipping ${fileName} (excluded)`));
            skippedCount++;
            continue;
        }

        const chunkTokens = estimateTokens(chunk) + estimateTokens(systemPrompt);
        if (chunkTokens > MAX_TOKENS_PER_REQUEST) {
            Logger.info(chalk.yellow(`   ⚠️  Skipping ${fileName} (too large: ~${chunkTokens} tokens)`));
            llmFindings.push({
                file: fileName,
                severity: Config.DEFAULT_SEVERITY,
                issues: [
                    {
                        title: "File too large for review",
                        description: `This file has ~${chunkTokens} tokens which exceeds the limit.`,
                        fixPrompt: "Consider splitting this file into smaller modules.",
                        source: "llm",
                    },
                ],
            });
            continue;
        }

        Logger.progress(chalk.dim(`   📄 ${fileName}...`));

        try {
            const { text } = await generateText({
                model: groq(MODEL_NAME),
                system: systemPrompt,
                prompt: `REVIEW THIS DIFF:\n\n${chunk}`,
                temperature: 0.1,
            });

            const response = parseReviewResponse(text);
            llmFindings.push({
                file: fileName,
                severity: response.severity,
                issues: response.issues.map((issue) => ({
                    ...issue,
                    source: "llm",
                })),
            });

            const emoji =
                response.severity === "LGTM"
                    ? "✅"
                    : response.severity === "P0_CRITICAL"
                        ? "🛑"
                        : response.severity === "P1_HIGH"
                            ? "⚠️"
                            : "📝";
            Logger.info(` ${emoji}`);
        } catch (error: any) {
            Logger.info(chalk.red(` ❌ (${error.message.slice(0, 50)})`));
            llmFindings.push({
                file: fileName,
                severity: Config.DEFAULT_SEVERITY,
                issues: [
                    {
                        title: "Review failed",
                        description: error.message,
                        fixPrompt: "Retry the review or check manually.",
                        source: "llm",
                    },
                ],
            });
        }

        if (chunkIndex < fileChunks.length) {
            await sleep(DELAY_BETWEEN_CHUNKS_MS);
        }
    }

    Logger.info(chalk.blue("\n🎯 Filtering by Confidence...\n"));
    let processedLlmFindings = filterByConfidence(llmFindings);

    if (Config.ENABLE_SELF_CRITIQUE) {
        processedLlmFindings = await critiqueFindings(processedLlmFindings, target.diff);
    }

    const deterministicReviewFindings = groupDeterministicFindings(deterministicReport.findings);
    const findings = mergeFindings(processedLlmFindings, deterministicReviewFindings);

    const metrics = {
        filesScanned: fileChunks.length - skippedCount,
        totalTokens,
        violations: findings.reduce((sum, finding) => sum + finding.issues.length, 0),
        critical: findings.filter((finding) => finding.severity === "P0_CRITICAL").length,
        high: findings.filter((finding) => finding.severity === "P1_HIGH").length,
        medium: findings.filter((finding) => finding.severity === "P2_MEDIUM").length,
        lgtm: findings.filter((finding) => finding.severity === "LGTM").length,
    };

    const report: DashboardReport = {
        date: new Date().toISOString().split("T")[0],
        reviewer: "Deterministic Security Pass & Judge",
        status: determineStatus(metrics),
        metrics,
        findings,
        recommendedAction: generateRecommendation(metrics),
    };

    const dashboard = renderDashboard(report);
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, dashboard);
    fs.writeFileSync(
        SESSION_FILE,
        JSON.stringify(
            {
                date: report.date,
                findings: report.findings,
                metrics: report.metrics,
            },
            null,
            2,
        ),
    );

    Logger.info("\n" + chalk.bold.green("📊 DASHBOARD GENERATED"));
    Logger.info(chalk.dim(`   Saved to: ${OUTPUT_FILE}`));
    Logger.info("\n" + chalk.bold.white("─".repeat(50)));

    const statusEmoji =
        report.status === "APPROVED"
            ? "🟢"
            : report.status === "NEEDS_REVIEW"
                ? "🟡"
                : "🔴";
    Logger.info(`\n${statusEmoji} Status: ${report.status.replace("_", " ")}`);
    Logger.info(`   🛑 Critical: ${metrics.critical}`);
    Logger.info(`   ⚠️  High: ${metrics.high}`);
    Logger.info(`   📝 Medium: ${metrics.medium}`);
    Logger.info(`   ✅ LGTM: ${metrics.lgtm}`);
    Logger.info(`\n💡 ${report.recommendedAction}`);
    Logger.info(chalk.dim(`\n📄 Full report: ${OUTPUT_FILE}`));

    if (Logger.isHeadless()) {
        Logger.json(report);
        return;
    }

    const { updatedFindings, hasUpdates } = await startInteractiveSession(findings, index);
    if (!hasUpdates) {
        return;
    }

    Logger.info(chalk.blue("\n🔄 Updating Dashboard with session changes..."));

    const newMetrics = {
        filesScanned: fileChunks.length - skippedCount,
        totalTokens,
        violations: updatedFindings.reduce((sum, finding) => sum + finding.issues.length, 0),
        critical: updatedFindings.filter((finding) => finding.severity === "P0_CRITICAL").length,
        high: updatedFindings.filter((finding) => finding.severity === "P1_HIGH").length,
        medium: updatedFindings.filter((finding) => finding.severity === "P2_MEDIUM").length,
        lgtm: updatedFindings.filter((finding) => finding.severity === "LGTM").length,
    };

    const newReport: DashboardReport = {
        ...report,
        metrics: newMetrics,
        findings: updatedFindings,
        status: determineStatus(newMetrics),
        recommendedAction: generateRecommendation(newMetrics),
    };

    fs.writeFileSync(OUTPUT_FILE, renderDashboard(newReport));
    fs.writeFileSync(
        SESSION_FILE,
        JSON.stringify(
            {
                date: newReport.date,
                findings: newReport.findings,
                metrics: newReport.metrics,
            },
            null,
            2,
        ),
    );

    Logger.info(chalk.bold.green("📊 DASHBOARD UPDATED"));
}

main().catch((error) => {
    Logger.error(error instanceof Error ? error.message : String(error));
});
