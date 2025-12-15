// src/core/analysis/rules/next-arch.ts
// God Mode Rules 5-8: Next.js Architecture
// Detects build breakers and silent runtime failures specific to Next.js App Router.

import { SourceFile, Node, SyntaxKind } from 'ts-morph';
import type { ContextViolation } from '../types.js';

// ============================================================
// RULE 5: TOXIC_SERVER_ACTION_ARG
// Detects non-serializable arguments passed to Server Actions
// ============================================================

// Non-serializable types that will break Server Actions
const NON_SERIALIZABLE_PATTERNS = [
    'Date',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'Function',
    'RegExp',
    'Error',
    'Promise',
];

/**
 * Check for non-serializable arguments in Server Action calls.
 * Server Actions can only receive JSON-serializable data.
 */
export function checkToxicArgs(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Check if this file has "use client" (client component calling server action)
    const fullText = sourceFile.getFullText();
    const isClientFile = /^['"]use client['"];?/m.test(fullText);

    if (!isClientFile) return violations;

    sourceFile.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
            // Check for "new Date()" or Date-returning patterns in arguments
            const args = node.getArguments();

            for (const arg of args) {
                const argText = arg.getText();

                // Check for "new Date()" pattern
                if (/new Date\s*\(/.test(argText)) {
                    violations.push({
                        line: arg.getStartLineNumber(),
                        code: 'TOXIC_SERVER_ACTION_ARG',
                        symbol: 'Date',
                        message: `Passing 'new Date()' to a function from client component. If this is a Server Action, Date objects are not serializable. Use 'date.toISOString()' instead.`,
                        severity: 'warning',
                    });
                }

                // Check for "new Map()" or "new Set()"
                for (const pattern of NON_SERIALIZABLE_PATTERNS) {
                    if (new RegExp(`new ${pattern}\\s*\\(`).test(argText)) {
                        violations.push({
                            line: arg.getStartLineNumber(),
                            code: 'TOXIC_SERVER_ACTION_ARG',
                            symbol: pattern,
                            message: `Passing 'new ${pattern}()' as argument. If this is a Server Action, ${pattern} is not serializable. Convert to a plain object or array.`,
                            severity: 'warning',
                        });
                    }
                }
            }
        }
    });

    return violations;
}

// ============================================================
// RULE 6: SECRET_LEAK_CLIENT
// Detects process.env.SECRET (non-NEXT_PUBLIC) in client components
// ============================================================

/**
 * Check for non-public environment variables in client components.
 * Only NEXT_PUBLIC_* vars are exposed to the browser.
 */
export function checkSecretLeak(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    const fullText = sourceFile.getFullText();
    const isClientFile = /^['"]use client['"];?/m.test(fullText);

    if (!isClientFile) return violations;

    sourceFile.forEachDescendant((node) => {
        if (Node.isPropertyAccessExpression(node)) {
            const text = node.getText();

            // Match process.env.SOMETHING
            const envMatch = text.match(/process\.env\.(\w+)/);
            if (envMatch) {
                const envVar = envMatch[1];

                // NEXT_PUBLIC_* is fine, everything else is a leak
                if (!envVar.startsWith('NEXT_PUBLIC_')) {
                    violations.push({
                        line: node.getStartLineNumber(),
                        code: 'SECRET_LEAK_CLIENT',
                        symbol: envVar,
                        message: `'process.env.${envVar}' in client component will be undefined at runtime. Only NEXT_PUBLIC_* vars are exposed to browser. Move to server or rename to NEXT_PUBLIC_${envVar}.`,
                        severity: 'error',
                    });
                }
            }
        }
    });

    return violations;
}

// ============================================================
// RULE 7: STATIC_EXPORT_MISMATCH
// Detects force-static pages using dynamic features
// ============================================================

/**
 * Check for static export mismatch (force-static + dynamic features).
 */
export function checkStaticMismatch(sourceFile: SourceFile, filename: string): ContextViolation[] {
    const violations: ContextViolation[] = [];
    const fullText = sourceFile.getFullText();

    // Check if page has force-static
    const hasForceStatic = /export\s+(const|let)\s+dynamic\s*=\s*['"]force-static['"]/.test(fullText);

    if (!hasForceStatic) return violations;

    // Check for dynamic patterns that conflict
    const dynamicPatterns = [
        { pattern: /headers\s*\(\s*\)/, name: 'headers()' },
        { pattern: /cookies\s*\(\s*\)/, name: 'cookies()' },
        { pattern: /searchParams/, name: 'searchParams' },
    ];

    for (const { pattern, name } of dynamicPatterns) {
        if (pattern.test(fullText)) {
            const match = fullText.match(pattern);
            if (match) {
                // Find line number
                const upToMatch = fullText.substring(0, match.index);
                const lineNumber = (upToMatch.match(/\n/g) || []).length + 1;

                violations.push({
                    line: lineNumber,
                    code: 'STATIC_EXPORT_MISMATCH',
                    symbol: name,
                    message: `Using '${name}' with 'dynamic = "force-static"' will cause build error. Remove force-static or refactor to avoid ${name}.`,
                    severity: 'error',
                });
            }
        }
    }

    // Check for dynamic route params [slug]
    if (/\[\w+\]/.test(filename)) {
        violations.push({
            line: 1,
            code: 'STATIC_EXPORT_MISMATCH',
            symbol: 'dynamic-route',
            message: `Dynamic route with 'force-static' requires generateStaticParams(). Without it, the page won't build.`,
            severity: 'warning',
        });
    }

    return violations;
}

// ============================================================
// Re-exports of existing rules (for modular access)
// ============================================================

// CLIENT_HOOK_IN_SERVER and WRONG_EXPORT_PATTERN remain in engine.ts
// but can be moved here in the future for full modularity.
