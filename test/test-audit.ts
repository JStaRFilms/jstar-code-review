import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runDeterministicAudit } from "../scripts/core/deterministic-audit";

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jstar-audit-"));

    fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, ".jstar"), { recursive: true });

    fs.writeFileSync(
        path.join(tempRoot, "src", "eval.ts"),
        [
            "export function runDynamic(code: string) {",
            "  return eval(code);",
            "}",
            "",
        ].join("\n"),
    );
    fs.writeFileSync(
        path.join(tempRoot, "src", "oversized.ts"),
        `export const payload = "${"a".repeat((1024 * 1024) + 32)}";\nprocess.env.INTERNAL_TOKEN;\n`,
    );
    fs.writeFileSync(path.join(tempRoot, ".env"), "API_KEY=super-secret-value\n");
    fs.writeFileSync(path.join(tempRoot, ".gitignore"), "node_modules\n");

    execFileSync("git", ["init"], { cwd: tempRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "tests@example.com"], { cwd: tempRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "J Star Tests"], { cwd: tempRoot, stdio: "ignore" });
    execFileSync("git", ["add", ".env"], { cwd: tempRoot, stdio: "ignore" });

    const report = await runDeterministicAudit({
        cwd: tempRoot,
        mode: "FULL_SCAN",
        target: ".",
        rootDir: tempRoot,
        includeRepositoryChecks: true,
    });

    assert(report.findings.some((finding) => finding.ruleId === "SEC-002"), "Expected eval() finding");
    assert(report.findings.some((finding) => finding.ruleId === "GUARD-002"), "Expected .gitignore gap finding");
    assert(report.findings.some((finding) => finding.ruleId === "GUARD-003"), "Expected tracked secret finding");
    assert.equal(report.summary.filesScanned, 1, "Oversized code files should be skipped from deterministic scanning");
    assert(
        !report.findings.some((finding) => finding.file === "src/oversized.ts"),
        "Oversized files should not emit deterministic findings",
    );

    fs.writeFileSync(
        path.join(tempRoot, ".jstar", "audit-ignore.json"),
        JSON.stringify(
            {
                ignores: [
                    {
                        ruleId: "SEC-002",
                        file: "src/eval.ts",
                        line: 2,
                        reason: "Intentional fixture for audit-ignore coverage",
                    },
                ],
            },
            null,
            2,
        ),
    );

    const ignoredReport = await runDeterministicAudit({
        cwd: tempRoot,
        mode: "FULL_SCAN",
        target: ".",
        rootDir: tempRoot,
        includeRepositoryChecks: true,
    });

    assert(!ignoredReport.findings.some((finding) => finding.ruleId === "SEC-002"), "Ignored finding should be removed from active output");
    assert(
        ignoredReport.ignoredFindings.some((finding) => finding.ruleId === "SEC-002"),
        "Ignored finding should be tracked separately",
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log("Audit tests passed: repo checks + ignore handling.");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
