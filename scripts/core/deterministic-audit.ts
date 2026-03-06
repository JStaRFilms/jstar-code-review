import * as fs from "fs";
import * as path from "path";
import simpleGit from "simple-git";
import { AuditCategory, AuditFinding, AuditIgnoreEntry, AuditReport, AuditSeverity } from "../types";
import { isCodeFile, normalizeRelativePath, walkProjectFiles } from "./project";

export const RULES_VERSION = "security-audit-v1";

interface BaseRule {
    id: string;
    title: string;
    severity: AuditSeverity;
    category: AuditCategory;
    recommendation: string;
    filePattern?: RegExp;
    excludePattern?: RegExp;
}

interface LineRule extends BaseRule {
    pattern: RegExp;
    buildMessage?: (line: string) => string;
}

interface FileRule extends BaseRule {
    test: RegExp;
    line?: number;
    message: string;
}

interface CustomRule extends BaseRule {
    scan: (content: string, normalizedPath: string) => AuditFinding[];
}

export interface RunDeterministicAuditOptions {
    cwd?: string;
    mode: string;
    target: string;
    filePaths?: string[];
    rootDir?: string;
    includeBuildFiles?: boolean;
    includeRepositoryChecks?: boolean;
}

const LINE_RULES: LineRule[] = [
    {
        id: "SEC-001",
        title: "Hardcoded secret in source",
        severity: "CRITICAL",
        category: "SECURITY",
        recommendation: "Move the credential to environment configuration and rotate the exposed secret.",
        pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"`][A-Za-z0-9._-]{10,}['"`]/i,
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        buildMessage: () => "Possible hardcoded credential detected in source.",
    },
    {
        id: "SEC-002",
        title: "Dynamic code execution",
        severity: "HIGH",
        category: "SECURITY",
        recommendation: "Remove dynamic evaluation and use explicit, validated control flow instead.",
        pattern: /\b(?:eval|Function)\s*\(/,
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        buildMessage: () => "Dynamic code execution can allow arbitrary code paths and should be avoided.",
    },
    {
        id: "SEC-003",
        title: "Unsafe raw SQL execution",
        severity: "HIGH",
        category: "SECURITY",
        recommendation: "Replace unsafe raw SQL helpers with parameterized queries or safe ORM APIs.",
        pattern: /\b(?:\$queryRawUnsafe|\$executeRawUnsafe|queryRawUnsafe|executeRawUnsafe)\s*\(/,
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        buildMessage: () => "Unsafe raw SQL helper detected; untrusted input can reach the database without parameterization.",
    },
    {
        id: "SEC-004",
        title: "Raw HTML injection sink",
        severity: "HIGH",
        category: "SECURITY",
        recommendation: "Avoid raw HTML injection or sanitize the content before rendering it.",
        pattern: /dangerouslySetInnerHTML\s*=\s*\{\{/,
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        buildMessage: () => "Raw HTML injection sink detected.",
    },
    {
        id: "QLT-001",
        title: "console.log in committed code",
        severity: "WARNING",
        category: "QUALITY",
        recommendation: "Remove ad-hoc console logging or route the message through the project logger.",
        pattern: /console\.log\(/,
        excludePattern: /(bin\/jstar\.js|scripts\/utils\/logger\.ts|setup\.js|test\/)/i,
        buildMessage: () => "console.log left in source can leak noisy or sensitive runtime details.",
    },
    {
        id: "QLT-002",
        title: "TODO or FIXME marker",
        severity: "INFO",
        category: "QUALITY",
        recommendation: "Replace TODO/FIXME comments with tracked work items or resolve them before release.",
        pattern: /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME)\b/i,
        buildMessage: () => "Unresolved TODO/FIXME marker found in code.",
    },
];

const FILE_RULES: FileRule[] = [
    {
        id: "ARCH-001",
        title: '"use client" is not the first statement',
        severity: "HIGH",
        category: "LOGIC",
        recommendation: 'Move the "use client" directive to the top of the module before imports or comments.',
        filePattern: /\.tsx?$/i,
        excludePattern: /(scripts|test)\//i,
        test: /^(?!(?:\s*|(?:\/\/[^\n]*\n)|(?:\/\*[\s\S]*?\*\/))*['"]use client['"]).*['"]use client['"]/s,
        message: 'Next.js requires "use client" to appear before any other statement in the file.',
        line: 1,
    },
];

const CUSTOM_RULES: CustomRule[] = [
    {
        id: "SEC-005",
        title: "Server env var referenced in client module",
        severity: "CRITICAL",
        category: "SECURITY",
        recommendation: "Do not reference server-only env vars from client code. Proxy the value through a server boundary or use NEXT_PUBLIC_ variables only when safe.",
        filePattern: /\.tsx?$/i,
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        scan: (content, normalizedPath) => {
            if (!/^\s*['"]use client['"]/m.test(content)) {
                return [];
            }

            const findings: AuditFinding[] = [];
            const lines = content.split("\n");
            const envPattern = /process\.env\.([A-Z0-9_]+)/g;

            lines.forEach((line, index) => {
                let match: RegExpExecArray | null;
                while ((match = envPattern.exec(line)) !== null) {
                    const envName = match[1];
                    if (envName.startsWith("NEXT_PUBLIC_")) {
                        continue;
                    }
                    findings.push({
                        ruleId: "SEC-005",
                        title: "Server env var referenced in client module",
                        severity: "CRITICAL",
                        category: "SECURITY",
                        file: normalizedPath,
                        line: index + 1,
                        message: `Client component references server-only environment variable "${envName}".`,
                        recommendation: "Move the access to a server-only boundary or expose a safe NEXT_PUBLIC_ value instead.",
                        source: "deterministic",
                    });
                }
            });

            return findings;
        },
    },
];

const AUDIT_IGNORE_FILE = path.join(".jstar", "audit-ignore.json");
const REQUIRED_GITIGNORE_PATTERNS = [".env", ".env.local", "node_modules", "*.pem", "*.key"];

const SEVERITY_RANK: Record<AuditSeverity, number> = {
    CRITICAL: 0,
    HIGH: 1,
    WARNING: 2,
    INFO: 3,
};

function cloneFinding(finding: AuditFinding): AuditFinding {
    return { ...finding };
}

function shouldApplyRule(rule: BaseRule, normalizedPath: string): boolean {
    if (rule.filePattern && !rule.filePattern.test(normalizedPath)) {
        return false;
    }

    if (rule.excludePattern && rule.excludePattern.test(normalizedPath)) {
        return false;
    }

    return true;
}

function sortFindings(findings: AuditFinding[]): AuditFinding[] {
    return findings.sort((left, right) => {
        const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
        if (severityDelta !== 0) {
            return severityDelta;
        }

        const fileDelta = left.file.localeCompare(right.file);
        if (fileDelta !== 0) {
            return fileDelta;
        }

        const lineDelta = (left.line ?? 0) - (right.line ?? 0);
        if (lineDelta !== 0) {
            return lineDelta;
        }

        return left.ruleId.localeCompare(right.ruleId);
    });
}

export function buildAuditRecommendation(summary: AuditReport["summary"]): string {
    if (summary.critical > 0) {
        return `Block release and fix ${summary.critical} critical finding(s) before proceeding.`;
    }

    if (summary.high > 0) {
        return `Resolve ${summary.high} high-severity finding(s) before treating the audit as complete.`;
    }

    if (summary.warning > 0) {
        return `Audit passed with warnings. Triage the ${summary.warning} warning(s) for follow-up work.`;
    }

    return "No deterministic security findings detected in the selected scope.";
}

export function mapAuditSeverityToReviewSeverity(severity: AuditSeverity): "P0_CRITICAL" | "P1_HIGH" | "P2_MEDIUM" {
    if (severity === "CRITICAL") {
        return "P0_CRITICAL";
    }

    if (severity === "HIGH") {
        return "P1_HIGH";
    }

    return "P2_MEDIUM";
}

export function scanFileContent(content: string, normalizedPath: string): AuditFinding[] {
    const findings: AuditFinding[] = [];
    const lines = content.split("\n");

    for (const rule of LINE_RULES) {
        if (!shouldApplyRule(rule, normalizedPath)) {
            continue;
        }

        lines.forEach((line, index) => {
            if (!rule.pattern.test(line)) {
                return;
            }

            findings.push({
                ruleId: rule.id,
                title: rule.title,
                severity: rule.severity,
                category: rule.category,
                file: normalizedPath,
                line: index + 1,
                message: rule.buildMessage?.(line) ?? rule.title,
                recommendation: rule.recommendation,
                source: "deterministic",
            });
        });
    }

    for (const rule of FILE_RULES) {
        if (!shouldApplyRule(rule, normalizedPath)) {
            continue;
        }

        if (!rule.test.test(content)) {
            continue;
        }

        findings.push({
            ruleId: rule.id,
            title: rule.title,
            severity: rule.severity,
            category: rule.category,
            file: normalizedPath,
            line: rule.line,
            message: rule.message,
            recommendation: rule.recommendation,
            source: "deterministic",
        });
    }

    for (const rule of CUSTOM_RULES) {
        if (!shouldApplyRule(rule, normalizedPath)) {
            continue;
        }

        findings.push(...rule.scan(content, normalizedPath));
    }

    return findings;
}

function loadAuditIgnores(cwd: string): AuditIgnoreEntry[] {
    const ignorePath = path.join(cwd, AUDIT_IGNORE_FILE);
    if (!fs.existsSync(ignorePath)) {
        return [];
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(ignorePath, "utf-8"));
        if (!parsed || !Array.isArray(parsed.ignores)) {
            return [];
        }

        return parsed.ignores
            .filter((entry: unknown): entry is AuditIgnoreEntry => {
                if (!entry || typeof entry !== "object") {
                    return false;
                }
                const candidate = entry as Record<string, unknown>;
                return typeof candidate.ruleId === "string";
            })
            .map((entry: AuditIgnoreEntry) => ({
                ...entry,
                file: entry.file ? normalizeRelativePath(entry.file, cwd) : undefined,
            }));
    } catch {
        return [];
    }
}

function matchIgnoreEntry(finding: AuditFinding, ignore: AuditIgnoreEntry): boolean {
    if (ignore.ruleId !== finding.ruleId) {
        return false;
    }

    if (ignore.file && ignore.file !== finding.file) {
        return false;
    }

    if (ignore.line !== undefined && ignore.line !== finding.line) {
        return false;
    }

    return true;
}

function applyIgnores(
    findings: AuditFinding[],
    ignores: AuditIgnoreEntry[],
): { findings: AuditFinding[]; ignoredFindings: AuditFinding[] } {
    const active: AuditFinding[] = [];
    const ignored: AuditFinding[] = [];

    findings.forEach((finding) => {
        const match = ignores.find((ignore) => matchIgnoreEntry(finding, ignore));
        if (!match) {
            active.push(finding);
            return;
        }

        ignored.push({
            ...cloneFinding(finding),
            ignoreReason: match.reason ?? "Ignored by audit-ignore.json",
        });
    });

    return {
        findings: sortFindings(active),
        ignoredFindings: sortFindings(ignored),
    };
}

async function runRepositoryChecks(cwd: string): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    const gitignorePath = path.join(cwd, ".gitignore");

    if (!fs.existsSync(gitignorePath)) {
        findings.push({
            ruleId: "GUARD-001",
            title: ".gitignore is missing",
            severity: "HIGH",
            category: "GUARDRAIL",
            file: ".gitignore",
            message: "Repository is missing .gitignore, increasing the chance of committing secrets or local artifacts.",
            recommendation: "Create a .gitignore that excludes environment files, dependencies, and local build artifacts.",
            source: "deterministic",
        });
    } else {
        const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
        const missingPatterns = REQUIRED_GITIGNORE_PATTERNS.filter((pattern) => !gitignoreContent.includes(pattern));
        if (missingPatterns.length > 0) {
            findings.push({
                ruleId: "GUARD-002",
                title: ".gitignore is missing sensitive patterns",
                severity: "HIGH",
                category: "GUARDRAIL",
                file: ".gitignore",
                message: `.gitignore is missing recommended sensitive patterns: ${missingPatterns.join(", ")}.`,
                recommendation: "Add the missing patterns so credentials and local artifacts stay out of version control.",
                source: "deterministic",
            });
        }
    }

    try {
        const git = simpleGit(cwd);
        const tracked = await git.raw(["ls-files", "--cached"]);
        const sensitiveFiles = tracked
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((file) => /(^|\/)\.env(?:$|\.local$|(?:\.[^/]+)?\.local$)|\.pem$|\.key$/i.test(file));

        sensitiveFiles.forEach((file) => {
            findings.push({
                ruleId: "GUARD-003",
                title: "Sensitive file tracked in git",
                severity: "CRITICAL",
                category: "SECURITY",
                file,
                message: `Sensitive file "${file}" is tracked by git and may already be exposed in repository history.`,
                recommendation: "Remove the file from version control, purge it from history if necessary, and rotate any exposed credentials.",
                source: "deterministic",
            });
        });
    } catch {
        // Repository checks are best-effort outside git worktrees.
    }

    return findings;
}

export async function runDeterministicAudit(
    options: RunDeterministicAuditOptions,
): Promise<AuditReport> {
    const cwd = options.cwd ?? process.cwd();
    const includeRepositoryChecks = options.includeRepositoryChecks ?? true;
    const rootDir = options.rootDir ?? cwd;
    const candidateFiles = options.filePaths
        ? options.filePaths.map((filePath) => normalizeRelativePath(filePath, cwd))
        : walkProjectFiles(rootDir, { cwd, includeBuildFiles: options.includeBuildFiles });

    const uniqueFiles = [...new Set(candidateFiles)]
        .filter((filePath) => isCodeFile(filePath))
        .sort((left, right) => left.localeCompare(right));

    const rawFindings: AuditFinding[] = [];

    for (const filePath of uniqueFiles) {
        const absolutePath = path.resolve(cwd, filePath);
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
            continue;
        }

        const content = fs.readFileSync(absolutePath, "utf-8");
        rawFindings.push(...scanFileContent(content, filePath));
    }

    if (includeRepositoryChecks) {
        rawFindings.push(...await runRepositoryChecks(cwd));
    }

    const ignores = loadAuditIgnores(cwd);
    const { findings, ignoredFindings } = applyIgnores(sortFindings(rawFindings), ignores);

    const summary = {
        filesScanned: uniqueFiles.length,
        findings: findings.length,
        critical: findings.filter((finding) => finding.severity === "CRITICAL").length,
        high: findings.filter((finding) => finding.severity === "HIGH").length,
        warning: findings.filter((finding) => finding.severity === "WARNING").length,
        info: findings.filter((finding) => finding.severity === "INFO").length,
        ignored: ignoredFindings.length,
    };

    return {
        date: new Date().toISOString().split("T")[0],
        mode: options.mode,
        target: options.target,
        rulesVersion: RULES_VERSION,
        summary,
        findings,
        ignoredFindings,
        recommendedAction: buildAuditRecommendation(summary),
    };
}
