import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import simpleGit from "simple-git";
import "./config";
import { renderAuditReport } from "./audit-report";
import { runDeterministicAudit } from "./core/deterministic-audit";
import { extractDiffFileNames, resolveReviewTarget } from "./core/review-target";
import { Logger } from "./utils/logger";

const MARKDOWN_OUTPUT = path.join(process.cwd(), ".jstar", "audit_report.md");
const JSON_OUTPUT = path.join(process.cwd(), ".jstar", "audit_report.json");

function hasDiffFlags(args: string[]): boolean {
    return ["--staged", "--last", "--commit", "--range", "--pr"].some((flag) => args.includes(flag));
}

function resolveCustomPath(args: string[]): { target: string; rootDir?: string; filePaths?: string[] } | null {
    const pathArgIndex = args.indexOf("--path");
    if (pathArgIndex === -1 || !args[pathArgIndex + 1]) {
        return null;
    }

    const resolved = path.resolve(process.cwd(), args[pathArgIndex + 1]);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Path not found: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
        return {
            target: path.relative(process.cwd(), resolved).replace(/\\/g, "/") || ".",
            rootDir: resolved,
        };
    }

    return {
        target: path.relative(process.cwd(), resolved).replace(/\\/g, "/"),
        filePaths: [resolved],
    };
}

async function main() {
    Logger.init();

    const args = process.argv.slice(2);
    const git = simpleGit();
    const diffMode = hasDiffFlags(args) || args.includes("--staged");
    const customPath = resolveCustomPath(args);

    Logger.info(chalk.blue("🔐 J-Star Security Audit: Running deterministic checks...\n"));

    const report = diffMode
        ? await runDiffAudit(git, args)
        : await runFullAudit(customPath);

    fs.mkdirSync(path.dirname(MARKDOWN_OUTPUT), { recursive: true });
    fs.writeFileSync(MARKDOWN_OUTPUT, renderAuditReport(report));
    fs.writeFileSync(JSON_OUTPUT, JSON.stringify(report, null, 2));

    if (Logger.isHeadless()) {
        Logger.json(report);
        return;
    }

    Logger.info(chalk.bold.green("🔐 SECURITY AUDIT COMPLETE"));
    Logger.info(`   Scope: ${report.mode}`);
    Logger.info(`   Target: ${report.target}`);
    Logger.info(`   Files scanned: ${report.summary.filesScanned}`);
    Logger.info(`   Critical: ${report.summary.critical}`);
    Logger.info(`   High: ${report.summary.high}`);
    Logger.info(`   Warning: ${report.summary.warning}`);
    Logger.info(`   Info: ${report.summary.info}`);
    Logger.info(chalk.dim(`   Markdown: ${MARKDOWN_OUTPUT}`));
    Logger.info(chalk.dim(`   JSON: ${JSON_OUTPUT}`));
    Logger.info(`\n💡 ${report.recommendedAction}`);
}

async function runDiffAudit(git: ReturnType<typeof simpleGit>, args: string[]) {
    const reviewTarget = await resolveReviewTarget(git, args);
    if (!reviewTarget.diff) {
        return runDeterministicAudit({
            mode: "DIFF_SCAN",
            target: reviewTarget.label,
            filePaths: [],
            includeRepositoryChecks: false,
        });
    }

    const filePaths = extractDiffFileNames(reviewTarget.diff)
        .map((filePath) => path.resolve(process.cwd(), filePath))
        .filter((filePath) => fs.existsSync(filePath));

    return runDeterministicAudit({
        mode: "DIFF_SCAN",
        target: reviewTarget.label,
        filePaths,
        includeRepositoryChecks: false,
    });
}

async function runFullAudit(
    customPath: { target: string; rootDir?: string; filePaths?: string[] } | null,
) {
    return runDeterministicAudit({
        mode: "FULL_SCAN",
        target: customPath?.target ?? ".",
        rootDir: customPath?.rootDir ?? process.cwd(),
        filePaths: customPath?.filePaths,
        includeRepositoryChecks: true,
    });
}

main().catch((error: Error) => {
    Logger.error(`❌ Security audit failed: ${error.message}`);
    process.exit(1);
});
