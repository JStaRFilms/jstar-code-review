/**
 * J-Star Reviewer Types
 * Structured types for dashboard output
 */

export type Severity = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'LGTM';

export interface ReviewIssue {
    title: string;
    description: string;
    line?: number;
    fixPrompt: string;
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
    }[];
}

/**
 * Default empty response for parse failures
 */
export const EMPTY_REVIEW: LLMReviewResponse = {
    severity: 'LGTM',
    issues: []
};




