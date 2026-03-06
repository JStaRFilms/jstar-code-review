import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { AuditFinding } from "./types";
import { scanFileContent } from "./core/deterministic-audit";
import { normalizeRelativePath, walkProjectFiles } from "./core/project";
import { Logger } from "./utils/logger";

interface Violation {
    file: string;
    line: number;
    message: string;
    severity: "high" | "medium" | "low";
    code: string;
}

function mapFindingToViolation(finding: AuditFinding): Violation {
    return {
        file: finding.file,
        line: finding.line ?? 1,
        message: `${finding.title}. ${finding.message}`,
        severity:
            finding.severity === "CRITICAL" || finding.severity === "HIGH"
                ? "high"
                : finding.severity === "WARNING"
                    ? "medium"
                    : "low",
        code: finding.ruleId,
    };
}

export class Detective {
    violations: Violation[] = [];
    private includeBuildFiles: boolean;

    constructor(private directory: string, options: { includeBuildFiles?: boolean } = {}) {
        this.includeBuildFiles = options.includeBuildFiles ?? false;
    }

    async scan(): Promise<Violation[]> {
        const files = walkProjectFiles(this.directory, {
            cwd: process.cwd(),
            includeBuildFiles: this.includeBuildFiles,
        });

        this.violations = files.flatMap((relativePath) => {
            const absolutePath = path.resolve(process.cwd(), relativePath);
            const content = fs.readFileSync(absolutePath, "utf-8");
            return scanFileContent(content, normalizeRelativePath(absolutePath)).map(mapFindingToViolation);
        });

        return this.violations;
    }

    report() {
        if (this.violations.length === 0) {
            Logger.info(chalk.green("✅ Detective Engine: No violations found."));
            return;
        }

        Logger.info(chalk.red(`🚨 Detective Engine found ${this.violations.length} violations:`));
        const total = this.violations.length;
        const toShow = this.violations.slice(0, 10);

        toShow.forEach((violation) => {
            const color = violation.severity === "high" ? chalk.red : chalk.yellow;
            Logger.info(color(`[${violation.code}] ${violation.file}:${violation.line} - ${violation.message}`));
        });

        if (total > 10) {
            Logger.dim(`... and ${total - 10} more.`);
        }
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const includeBuildFiles = args.includes("--all");
    const detective = new Detective(process.cwd(), { includeBuildFiles });
    detective.scan().then(() => detective.report());
}
