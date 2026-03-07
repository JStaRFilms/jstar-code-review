import * as fs from "fs";
import * as path from "path";
import simpleGit from "simple-git";
import ts from "typescript";
import { AuditCategory, AuditFinding, AuditIgnoreEntry, AuditReport, AuditSeverity } from "../types";
import { Logger } from "../utils/logger";
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
    sourceView?: "raw" | "code";
}

interface FileRule extends BaseRule {
    test: (content: string) => boolean;
    line?: number | ((content: string) => number | undefined);
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

interface StatementLine {
    line: number;
    text: string;
}

interface SignificantToken {
    kind: ts.SyntaxKind;
    line: number;
    text: string;
}

function readStringLiteral(source: string, start: number): { value: string; end: number } | null {
    const quote = source[start];
    if (quote !== '"' && quote !== "'") {
        return null;
    }

    let value = "";

    for (let index = start + 1; index < source.length; index++) {
        const char = source[index];
        if (char === "\r" || char === "\n") {
            return null;
        }

        if (char === "\\") {
            if (index + 1 >= source.length) {
                return null;
            }
            value += source.slice(index, index + 2);
            index++;
            continue;
        }

        if (char === quote) {
            return { value, end: index + 1 };
        }

        value += char;
    }

    return null;
}

function isStatementTerminated(source: string, index: number): boolean {
    let cursor = index;

    while (cursor < source.length) {
        const char = source[cursor];
        if (char === " " || char === "\t" || char === "\v" || char === "\f") {
            cursor++;
            continue;
        }

        if (char === ";") {
            return true;
        }

        if (source.startsWith("//", cursor)) {
            return true;
        }

        if (source.startsWith("/*", cursor)) {
            const commentEnd = source.indexOf("*/", cursor + 2);
            if (commentEnd === -1) {
                return false;
            }
            cursor = commentEnd + 2;
            continue;
        }

        return false;
    }

    return true;
}

function isUseClientDirectiveStatement(statement: string): boolean {
    const directive = readStringLiteral(statement, 0);
    return directive?.value === "use client" && isStatementTerminated(statement, directive.end);
}

function collectStatementLines(content: string): StatementLine[] {
    const statements: StatementLine[] = [];
    const lines = content.split(/\r?\n/);
    let inBlockComment = false;

    nextLine: for (let index = 0; index < lines.length; index++) {
        const rawLine = lines[index];
        const line = index === 0 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
        if (!inBlockComment && index === 0 && line.startsWith("#!")) {
            continue;
        }

        let cursor = 0;

        while (cursor < line.length) {
            if (inBlockComment) {
                const commentEnd = line.indexOf("*/", cursor);
                if (commentEnd === -1) {
                    continue nextLine;
                }
                inBlockComment = false;
                cursor = commentEnd + 2;
                continue;
            }

            const char = line[cursor];
            if (char === " " || char === "\t" || char === "\v" || char === "\f") {
                cursor++;
                continue;
            }

            if (line.startsWith("//", cursor)) {
                continue nextLine;
            }

            if (line.startsWith("/*", cursor)) {
                inBlockComment = true;
                cursor += 2;
                continue;
            }

            statements.push({
                line: index + 1,
                text: line.slice(cursor),
            });
            continue nextLine;
        }
    }

    return statements;
}

function hasUseClientAsFirstStatement(content: string): boolean {
    const firstStatement = collectStatementLines(content)[0];
    return firstStatement ? isUseClientDirectiveStatement(firstStatement.text) : false;
}

function findUseClientDirectiveLine(content: string): number | undefined {
    return collectStatementLines(content).find((statement) => isUseClientDirectiveStatement(statement.text))?.line;
}

function getLanguageVariant(normalizedPath: string): ts.LanguageVariant {
    return /\.(?:[jt]sx)$/i.test(normalizedPath) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
}

function getScriptKind(normalizedPath: string): ts.ScriptKind {
    if (/\.tsx$/i.test(normalizedPath)) {
        return ts.ScriptKind.TSX;
    }
    if (/\.jsx$/i.test(normalizedPath)) {
        return ts.ScriptKind.JSX;
    }
    if (/\.js$/i.test(normalizedPath)) {
        return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
}

function maskTriviaText(text: string): string {
    return text.replace(/[^\r\n]/g, " ");
}

function shouldMaskInCodeView(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        kind === ts.SyntaxKind.MultiLineCommentTrivia ||
        kind === ts.SyntaxKind.ShebangTrivia ||
        kind === ts.SyntaxKind.StringLiteral ||
        kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
        kind === ts.SyntaxKind.TemplateHead ||
        kind === ts.SyntaxKind.TemplateMiddle ||
        kind === ts.SyntaxKind.TemplateTail ||
        kind === ts.SyntaxKind.JsxText ||
        kind === ts.SyntaxKind.JsxTextAllWhiteSpaces ||
        kind === ts.SyntaxKind.RegularExpressionLiteral
    );
}

function buildCodeView(content: string, normalizedPath: string): string {
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        false,
        getLanguageVariant(normalizedPath),
        content,
    );

    let masked = "";
    let cursor = 0;

    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        const tokenStart = scanner.getTokenPos();
        const tokenEnd = scanner.getTextPos();
        const tokenText = scanner.getTokenText();

        if (tokenStart > cursor) {
            masked += content.slice(cursor, tokenStart);
        }

        masked += shouldMaskInCodeView(token) ? maskTriviaText(tokenText) : tokenText;
        cursor = tokenEnd;
    }

    if (cursor < content.length) {
        masked += content.slice(cursor);
    }

    return masked;
}

function isTriviaToken(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        kind === ts.SyntaxKind.MultiLineCommentTrivia ||
        kind === ts.SyntaxKind.NewLineTrivia ||
        kind === ts.SyntaxKind.WhitespaceTrivia ||
        kind === ts.SyntaxKind.ShebangTrivia
    );
}

function collectSignificantTokens(content: string, normalizedPath: string): SignificantToken[] {
    const sourceFile = ts.createSourceFile(
        normalizedPath,
        content,
        ts.ScriptTarget.Latest,
        false,
        getScriptKind(normalizedPath),
    );
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        false,
        getLanguageVariant(normalizedPath),
        content,
    );
    const tokens: SignificantToken[] = [];

    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        if (isTriviaToken(kind)) {
            continue;
        }

        tokens.push({
            kind,
            line: ts.getLineAndCharacterOfPosition(sourceFile, scanner.getTokenPos()).line + 1,
            text: scanner.getTokenText(),
        });
    }

    return tokens;
}

const SECRET_NAME_PATTERN = /^(?:api[_-]?key|password|(?:access|auth|bearer|client|refresh|session)?[_-]?(?:secret|token))$/i;

function normalizeTokenName(token: SignificantToken): string | null {
    if (token.kind === ts.SyntaxKind.Identifier) {
        return token.text;
    }

    if (token.kind === ts.SyntaxKind.StringLiteral) {
        return token.text.slice(1, -1);
    }

    return null;
}

function readStringTokenValue(token: SignificantToken): string | null {
    if (token.kind === ts.SyntaxKind.StringLiteral || token.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
        return token.text.slice(1, -1);
    }

    return null;
}

function scanHardcodedSecrets(content: string, normalizedPath: string): AuditFinding[] {
    const findings: AuditFinding[] = [];
    const tokens = collectSignificantTokens(content, normalizedPath);

    for (let index = 0; index < tokens.length - 2; index++) {
        const token = tokens[index];
        const candidateName = normalizeTokenName(token);
        if (!candidateName || !SECRET_NAME_PATTERN.test(candidateName)) {
            continue;
        }

        const operator = tokens[index + 1];
        if (operator.kind !== ts.SyntaxKind.EqualsToken && operator.kind !== ts.SyntaxKind.ColonToken) {
            continue;
        }

        const value = readStringTokenValue(tokens[index + 2]);
        if (!value || value.length < 10) {
            continue;
        }

        findings.push({
            ruleId: "SEC-001",
            title: "Hardcoded secret in source",
            severity: "CRITICAL",
            category: "SECURITY",
            file: normalizedPath,
            line: token.line,
            message: "Possible hardcoded credential detected in source.",
            recommendation: "Move the credential to environment configuration and rotate the exposed secret.",
            source: "deterministic",
        });
    }

    return findings;
}

const LINE_RULES: LineRule[] = [
    {
        id: "SEC-002",
        title: "Dynamic code execution",
        severity: "HIGH",
        category: "SECURITY",
        recommendation: "Remove dynamic evaluation and use explicit, validated control flow instead.",
        pattern: /\b(?:eval|Function)\s*\(/,
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        buildMessage: () => "Dynamic code execution can allow arbitrary code paths and should be avoided.",
        sourceView: "code",
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
        sourceView: "code",
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
        sourceView: "code",
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
        sourceView: "code",
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
        recommendation: 'Move the "use client" directive above imports and executable statements so it stays the first statement in the module.',
        filePattern: /\.tsx?$/i,
        excludePattern: /(scripts|test)\//i,
        test: (content) => Boolean(findUseClientDirectiveLine(content)) && !hasUseClientAsFirstStatement(content),
        message: 'Next.js requires "use client" to be the first statement in the file.',
        line: (content) => findUseClientDirectiveLine(content) ?? 1,
    },
];

const CUSTOM_RULES: CustomRule[] = [
    {
        id: "SEC-001",
        title: "Hardcoded secret in source",
        severity: "CRITICAL",
        category: "SECURITY",
        recommendation: "Move the credential to environment configuration and rotate the exposed secret.",
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        scan: (content, normalizedPath) => scanHardcodedSecrets(content, normalizedPath),
    },
    {
        id: "SEC-005",
        title: "Server env var referenced in client module",
        severity: "CRITICAL",
        category: "SECURITY",
        recommendation: "Do not reference server-only env vars from client code. Proxy the value through a server boundary or use NEXT_PUBLIC_ variables only when safe.",
        filePattern: /\.tsx?$/i,
        excludePattern: /(^|\/)(test|tests|fixtures?|mocks?|spec)\//i,
        scan: (content, normalizedPath) => {
            if (!hasUseClientAsFirstStatement(content)) {
                return [];
            }

            const findings: AuditFinding[] = [];
            const codeView = buildCodeView(content, normalizedPath);
            const sourceFile = ts.createSourceFile(
                normalizedPath,
                content,
                ts.ScriptTarget.Latest,
                false,
                getScriptKind(normalizedPath),
            );
            const envPattern = /process\.env\.([A-Z0-9_]+)/g;

            let match: RegExpExecArray | null;
            envPattern.lastIndex = 0;
            while ((match = envPattern.exec(codeView)) !== null) {
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
                    line: ts.getLineAndCharacterOfPosition(sourceFile, match.index).line + 1,
                    message: `Client component references server-only environment variable "${envName}".`,
                    recommendation: "Move the access to a server-only boundary or expose a safe NEXT_PUBLIC_ value instead.",
                    source: "deterministic",
                });
            }

            return findings;
        },
    },
];

const AUDIT_IGNORE_FILE = path.join(".jstar", "audit-ignore.json");
const REQUIRED_GITIGNORE_PATTERNS = [".env", ".env.local", "node_modules", "*.pem", "*.key"];
const MAX_AUDIT_FILE_SIZE_BYTES = 1024 * 1024;

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
    const rawLines = content.split(/\r?\n/);
    const codeLines = buildCodeView(content, normalizedPath).split(/\r?\n/);

    for (const rule of LINE_RULES) {
        if (!shouldApplyRule(rule, normalizedPath)) {
            continue;
        }

        const lines = rule.sourceView === "code" ? codeLines : rawLines;

        lines.forEach((line, index) => {
            rule.pattern.lastIndex = 0;
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

        if (!rule.test(content)) {
            continue;
        }

        const line = typeof rule.line === "function" ? rule.line(content) : rule.line;
        findings.push({
            ruleId: rule.id,
            title: rule.title,
            severity: rule.severity,
            category: rule.category,
            file: normalizedPath,
            line,
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
        Logger.warn("Repository checks skipped: unable to access git metadata.");
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
    let scannedFiles = 0;

    for (const filePath of uniqueFiles) {
        const absolutePath = path.resolve(cwd, filePath);
        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        const fileStats = fs.statSync(absolutePath);
        if (!fileStats.isFile()) {
            continue;
        }

        if (fileStats.size > MAX_AUDIT_FILE_SIZE_BYTES) {
            Logger.warn(
                `Skipping deterministic audit for "${filePath}" because it exceeds ${MAX_AUDIT_FILE_SIZE_BYTES} bytes.`,
            );
            continue;
        }

        const content = fs.readFileSync(absolutePath, "utf-8");
        scannedFiles++;
        rawFindings.push(...scanFileContent(content, filePath));
    }

    if (includeRepositoryChecks) {
        rawFindings.push(...await runRepositoryChecks(cwd));
    }

    const ignores = loadAuditIgnores(cwd);
    const { findings, ignoredFindings } = applyIgnores(sortFindings(rawFindings), ignores);

    const summary = {
        filesScanned: scannedFiles,
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
