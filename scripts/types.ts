/**
 * J-Star Reviewer Types
 * Structured types for dashboard output
 */

export type Severity = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'LGTM';
export type AuditSeverity = 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO';
export type AuditCategory = 'SECURITY' | 'LOGIC' | 'QUALITY' | 'GUARDRAIL';

export interface ReviewIssue {
    title: string;
    description: string;
    line?: number;
    fixPrompt: string;
    confidenceScore?: number;
    ruleId?: string;
    source?: 'llm' | 'deterministic';
    status?: 'resolved' | 'ignored' | 'accepted';
}

export interface FileFinding {
    file: string;
    severity: Severity;
    issues: ReviewIssue[];
}

export interface DashboardReport {
    date: string;
    reviewer: string;
    status: 'CRITICAL_FAILURE' | 'NEEDS_REVIEW' | 'APPROVED';
    metrics: {
        filesScanned: number;
        totalTokens: number;
        violations: number;
        critical: number;
        high: number;
        medium: number;
        lgtm: number;
    };
    findings: FileFinding[];
    recommendedAction: string;
}

export interface AuditFinding {
    ruleId: string;
    title: string;
    severity: AuditSeverity;
    category: AuditCategory;
    file: string;
    line?: number;
    message: string;
    recommendation: string;
    source: 'deterministic';
    ignoreReason?: string;
}

export interface AuditIgnoreEntry {
    ruleId: string;
    file?: string;
    line?: number;
    reason?: string;
}

export interface AuditSummary {
    filesScanned: number;
    findings: number;
    critical: number;
    high: number;
    warning: number;
    info: number;
    ignored: number;
}

export interface AuditReport {
    date: string;
    mode: string;
    target: string;
    rulesVersion: string;
    summary: AuditSummary;
    findings: AuditFinding[];
    ignoredFindings: AuditFinding[];
    recommendedAction: string;
}

export interface SessionState {
    date: string;
    findings: FileFinding[];
    metrics: DashboardReport['metrics'];
}

/**
 * Schema for LLM response (per-file review)
 */
export interface LLMReviewResponse {
    severity: Severity;
    issues: {
        title: string;
        description: string;
        line?: number;
        fixPrompt: string;
        confidenceScore?: number;  // 1-5 confidence rating
    }[];
}

/**
 * Default empty response for parse failures
 */
export const EMPTY_REVIEW: LLMReviewResponse = {
    severity: 'LGTM',
    issues: []
};




