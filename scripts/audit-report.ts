import { AuditFinding, AuditReport, AuditSeverity } from "./types";

const SEVERITY_EMOJI: Record<AuditSeverity, string> = {
    CRITICAL: "🛑",
    HIGH: "⚠️",
    WARNING: "📝",
    INFO: "ℹ️",
};

function renderFindingRow(finding: AuditFinding): string {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    return `| ${SEVERITY_EMOJI[finding.severity]} ${finding.severity} | ${finding.category} | \`${location}\` | **${finding.ruleId}** ${finding.title}<br>${finding.message} | ${finding.recommendation} |`;
}

export function renderAuditReport(report: AuditReport): string {
    let markdown = `# J-Star Security Audit Report

**Date:** \`${report.date}\`  
**Scope:** \`${report.mode}\`  
**Target:** \`${report.target}\`  
**Ruleset:** \`${report.rulesVersion}\`

---

## Summary

| Metric | Value |
| --- | --- |
| Files scanned | ${report.summary.filesScanned} |
| Active findings | ${report.summary.findings} |
| Critical | ${report.summary.critical} |
| High | ${report.summary.high} |
| Warning | ${report.summary.warning} |
| Info | ${report.summary.info} |
| Ignored | ${report.summary.ignored} |

> ${report.recommendedAction}

---

## Findings

`;

    if (report.findings.length === 0) {
        markdown += "No deterministic security findings detected.\n";
    } else {
        markdown += `| Severity | Category | Location | Issue | Recommendation |
| --- | --- | --- | --- | --- |
`;

        report.findings.forEach((finding) => {
            markdown += renderFindingRow(finding) + "\n";
        });
    }

    if (report.ignoredFindings.length > 0) {
        markdown += `

---

## Ignored Findings

| Severity | Category | Location | Issue | Ignore Reason |
| --- | --- | --- | --- | --- |
`;

        report.ignoredFindings.forEach((finding) => {
            const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
            markdown += `| ${SEVERITY_EMOJI[finding.severity]} ${finding.severity} | ${finding.category} | \`${location}\` | **${finding.ruleId}** ${finding.title} | ${finding.ignoreReason ?? "Ignored"} |\n`;
        });
    }

    return markdown + "\n";
}
