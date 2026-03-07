import { FileFinding, ReviewIssue, Severity } from "../types";

const SEVERITY_RANK: Record<Severity, number> = {
    P0_CRITICAL: 0,
    P1_HIGH: 1,
    P2_MEDIUM: 2,
    LGTM: 3,
};

export function severityMax(left: Severity, right: Severity): Severity {
    return SEVERITY_RANK[left] <= SEVERITY_RANK[right] ? left : right;
}

function buildIssueKey(issue: ReviewIssue): string {
    return `${issue.line ?? 0}:${issue.title.trim().toLowerCase()}`;
}

function issuePriority(issue: ReviewIssue): number {
    return (issue.source === "deterministic" ? 10 : 0) + (issue.confidenceScore ?? 0);
}

function mergeIssue(existing: ReviewIssue, incoming: ReviewIssue): ReviewIssue {
    const preferred = issuePriority(existing) >= issuePriority(incoming) ? existing : incoming;
    const fallback = preferred === existing ? incoming : existing;
    const confidenceScore = Math.max(existing.confidenceScore ?? 0, incoming.confidenceScore ?? 0);

    return {
        ...fallback,
        ...preferred,
        description: preferred.description.length >= fallback.description.length ? preferred.description : fallback.description,
        fixPrompt: preferred.fixPrompt.length >= fallback.fixPrompt.length ? preferred.fixPrompt : fallback.fixPrompt,
        confidenceScore: confidenceScore > 0 ? confidenceScore : undefined,
        ruleId: preferred.ruleId ?? fallback.ruleId,
        source: preferred.source ?? fallback.source,
        status: preferred.status ?? fallback.status,
    };
}

function dedupeIssues(issues: ReviewIssue[]): ReviewIssue[] {
    const deduped = new Map<string, ReviewIssue>();

    issues.forEach((issue) => {
        const key = buildIssueKey(issue);
        const existing = deduped.get(key);
        if (!existing) {
            deduped.set(key, { ...issue });
            return;
        }

        deduped.set(key, mergeIssue(existing, issue));
    });

    return [...deduped.values()];
}

export function mergeFindings(primary: FileFinding[], secondary: FileFinding[]): FileFinding[] {
    const grouped = new Map<string, FileFinding>();

    const insert = (finding: FileFinding) => {
        const existing = grouped.get(finding.file);
        if (!existing) {
            grouped.set(finding.file, {
                ...finding,
                issues: dedupeIssues(finding.issues),
            });
            return;
        }

        existing.severity = severityMax(existing.severity, finding.severity);
        existing.issues = dedupeIssues([...existing.issues, ...finding.issues]);
    };

    primary.forEach(insert);
    secondary.forEach(insert);

    return [...grouped.values()]
        .map((finding) => ({
            ...finding,
            issues: finding.issues.sort((left, right) => {
                const lineDelta = (left.line ?? 0) - (right.line ?? 0);
                if (lineDelta !== 0) {
                    return lineDelta;
                }
                return left.title.localeCompare(right.title);
            }),
        }))
        .sort((left, right) => left.file.localeCompare(right.file));
}
