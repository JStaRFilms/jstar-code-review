/**
 * J-Star Dashboard Renderer
 * Generates professional markdown dashboard from review findings
 */

import { DashboardReport, FileFinding, ReviewIssue, Severity } from './types';
import { Config } from './config';

const SEVERITY_EMOJI: Record<Severity, string> = {
    'P0_CRITICAL': '🛑',
    'P1_HIGH': '⚠️',
    'P2_MEDIUM': '📝',
    'LGTM': '✅'
};

const SEVERITY_LABEL: Record<Severity, string> = {
    'P0_CRITICAL': 'CRITICAL',
    'P1_HIGH': 'HIGH',
    'P2_MEDIUM': 'MEDIUM',
    'LGTM': 'PASSED'
};

function getStatusEmoji(status: DashboardReport['status']): string {
    switch (status) {
        case 'CRITICAL_FAILURE': return '🔴';
        case 'NEEDS_REVIEW': return '🟡';
        case 'APPROVED': return '🟢';
    }
}

function formatDate(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Renders a single issue row for the markdown table.
 * Includes fallback handling for unexpected severity values to ensure
 * the dashboard renders gracefully even if parsing produced invalid data.
 */
function renderIssueRow(file: string, issue: ReviewIssue, severity: Severity): string {
    // Fallback to '❓' and raw severity if the value is not in our known maps
    const emoji = SEVERITY_EMOJI[severity] ?? '❓';
    const label = SEVERITY_LABEL[severity] ?? severity;
    return `| \`${file}\` | ${emoji} **${label}** | ${issue.title} |`;
}

function renderFixPrompt(issue: ReviewIssue): string {
    if (!issue.fixPrompt) return '';
    return `
<details>
<summary>🤖 <strong>Fix Prompt:</strong> ${issue.title}</summary>

\`\`\`
${issue.fixPrompt}
\`\`\`

</details>
`;
}

/**
 * Validates that the report object has the required structure.
 * This guards against runtime errors from malformed LLM responses or corrupted data.
 */
function validateReport(report: unknown): report is DashboardReport {
    if (!report || typeof report !== 'object') return false;
    const r = report as Record<string, unknown>;

    // Check required fields exist
    if (typeof r.status !== 'string') return false;
    if (typeof r.recommendedAction !== 'string') return false;
    if (!Array.isArray(r.findings)) return false;
    if (!r.metrics || typeof r.metrics !== 'object') return false;

    // Validate metrics structure
    const m = r.metrics as Record<string, unknown>;
    const requiredMetrics = ['filesScanned', 'totalTokens', 'violations', 'critical', 'high', 'medium', 'lgtm'];
    for (const key of requiredMetrics) {
        if (typeof m[key] !== 'number') return false;
    }

    return true;
}

export function renderDashboard(report: DashboardReport): string {
    // Runtime validation to catch malformed reports early
    if (!validateReport(report)) {
        throw new Error('Invalid DashboardReport: missing or malformed required fields');
    }

    const { metrics, findings, status, recommendedAction } = report;

    // Group findings by severity
    const critical = findings.filter(f => f.severity === 'P0_CRITICAL');
    const high = findings.filter(f => f.severity === 'P1_HIGH');
    const medium = findings.filter(f => f.severity === 'P2_MEDIUM');
    const lgtm = findings.filter(f => f.severity === 'LGTM');

    let md = `# 📊 J-STAR CODE REVIEW DASHBOARD

**Date:** \`${formatDate()}\` | **Reviewer:** \`Detective Engine & Judge\` | **Status:** ${getStatusEmoji(status)} **${status.replace('_', ' ')}**

---

## 1. 📈 EXECUTIVE SUMMARY

| Metric | Value | Status |
| --- | --- | --- |
| **Files Scanned** | **${metrics.filesScanned}** | 🔎 Complete |
| **Total Tokens** | **~${metrics.totalTokens.toLocaleString()}** | ⚖️ Processed |
| **Total Violations** | **${metrics.violations}** | ${metrics.violations > 0 ? '🚨 Action Required' : '✅ Clean'} |
| **Critical (P0)** | **${metrics.critical}** | ${metrics.critical > 0 ? '🛑 **BLOCKER**' : '✅ None'} |
| **High (P1)** | **${metrics.high}** | ${metrics.high > 0 ? '⚠️ Needs Fix' : '✅ None'} |
| **Medium (P2)** | **${metrics.medium}** | ${metrics.medium > 0 ? '📝 Review' : '✅ None'} |
| **Passed (LGTM)** | **${metrics.lgtm}** | ✅ Clean |

---

`;

    // Critical Section
    if (critical.length > 0) {
        md += `## 2. 🛑 CRITICAL SECURITY VULNERABILITIES (P0)

> **These files contain blockers that must be fixed before any merge.**

| File | Severity | Issue |
| --- | --- | --- |
`;
        for (const finding of critical) {
            for (const issue of finding.issues) {
                md += renderIssueRow(finding.file, issue, 'P0_CRITICAL') + '\n';
            }
        }
        md += '\n### 🤖 Fix Prompts (P0)\n\n';
        for (const finding of critical) {
            for (const issue of finding.issues) {
                md += renderFixPrompt(issue);
            }
        }
        md += '\n---\n\n';
    }

    // High Section
    if (high.length > 0) {
        md += `## 3. ⚠️ HIGH PRIORITY ISSUES (P1)

> **Architecture and logic issues requiring significant attention.**

| File | Severity | Issue |
| --- | --- | --- |
`;
        for (const finding of high) {
            for (const issue of finding.issues) {
                md += renderIssueRow(finding.file, issue, 'P1_HIGH') + '\n';
            }
        }
        md += '\n### 🤖 Fix Prompts (P1)\n\n';
        for (const finding of high) {
            for (const issue of finding.issues) {
                md += renderFixPrompt(issue);
            }
        }
        md += '\n---\n\n';
    }

    // Medium Section
    if (medium.length > 0) {
        md += `## 4. 📝 MEDIUM PRIORITY ISSUES (P2)

> **Code quality and maintenance items.**

| File | Severity | Issue |
| --- | --- | --- |
`;
        for (const finding of medium) {
            for (const issue of finding.issues) {
                md += renderIssueRow(finding.file, issue, 'P2_MEDIUM') + '\n';
            }
        }
        md += '\n---\n\n';
    }

    // LGTM Section
    if (lgtm.length > 0) {
        md += `## 5. ✅ PASSED REVIEW (LGTM)

> **No issues found in these files.**

`;
        for (const finding of lgtm) {
            md += `- \`${finding.file}\`\n`;
        }
        md += '\n---\n\n';
    }

    // Recommended Action
    md += `## 🎯 RECOMMENDED ACTION

> ${recommendedAction}

---

*Generated by J-Star Code Reviewer v2*
`;

    return md;
}

export function determineStatus(metrics: DashboardReport['metrics']): DashboardReport['status'] {
    if (metrics.critical > 0) return 'CRITICAL_FAILURE';
    if (metrics.high > 0 || metrics.medium > Config.THRESHOLDS.MEDIUM) return 'NEEDS_REVIEW';
    return 'APPROVED';
}

export function generateRecommendation(metrics: DashboardReport['metrics']): string {
    if (metrics.critical > 0) {
        return `**BLOCK MERGE:** Fix ${metrics.critical} critical issue(s) immediately. Review P0 fix prompts above.`;
    }
    if (metrics.high > 0) {
        return `**Request Changes:** Address ${metrics.high} high-priority issue(s) before merging.`;
    }
    if (metrics.medium > 0) {
        return `**Approve with Notes:** ${metrics.medium} medium issues found. Consider fixing in follow-up PR.`;
    }
    return `**Approve:** All files passed review. Ship it! 🚀`;
}
