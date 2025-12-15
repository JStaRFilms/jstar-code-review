// src/core/analysis/rules/server-safety.ts
// God Mode Rules 1-4: Server Safety
// Detects runtime bombs that crash in serverless environments.

import { SourceFile, Node, SyntaxKind, CallExpression, VariableDeclarationKind } from 'ts-morph';
import type { ContextViolation } from '../types.js';

// ============================================================
// RULE 1: FLOATING_PROMISE
// Detects async calls without await/return/Promise.all
// ============================================================

/**
 * Check for floating promises (async calls not awaited).
 * Catches: prisma.create(), fetch(), any async function call without await.
 */
export function checkFloatingPromise(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Known async patterns that return promises
    const asyncPatterns = [
        /prisma\.\w+\.(create|update|delete|upsert|findFirst|findUnique|findMany)/,
        /\.query\(/,
        /\.execute\(/,
        /fetch\(/,
        /axios\./,
        /\.json\(/,
        /\.save\(/,
        /\.remove\(/,
    ];

    sourceFile.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
            const callText = node.getText();
            const isAsyncCall = asyncPatterns.some(p => p.test(callText));

            if (isAsyncCall) {
                const parent = node.getParent();

                // Check if properly handled
                const isAwaited = parent && Node.isAwaitExpression(parent);
                const isReturned = parent && Node.isReturnStatement(parent);
                const isInPromiseAll = isInsidePromiseAll(node);
                const isAssigned = parent && (
                    Node.isVariableDeclaration(parent) ||
                    Node.isPropertyAssignment(parent) ||
                    Node.isBinaryExpression(parent)
                );
                const isChained = node.getParent()?.getKind() === SyntaxKind.PropertyAccessExpression;

                if (!isAwaited && !isReturned && !isInPromiseAll && !isAssigned && !isChained) {
                    violations.push({
                        line: node.getStartLineNumber(),
                        code: 'FLOATING_PROMISE',
                        symbol: callText.slice(0, 50) + (callText.length > 50 ? '...' : ''),
                        message: `Floating promise detected. This async operation is not awaited, returned, or handled. It may complete after the response is sent, causing data loss or race conditions.`,
                        severity: 'error',
                    });
                }
            }
        }
    });

    return violations;
}

function isInsidePromiseAll(node: Node): boolean {
    let current = node.getParent();
    while (current) {
        if (Node.isCallExpression(current)) {
            const expr = current.getExpression().getText();
            if (expr === 'Promise.all' || expr === 'Promise.allSettled') {
                return true;
            }
        }
        current = current.getParent();
    }
    return false;
}

// ============================================================
// RULE 2: N_PLUS_ONE_WATERFALL
// Detects DB calls inside loops/maps that reference loop variable
// ============================================================

/**
 * Check for N+1 query patterns (DB call inside loop).
 */
export function checkNPlusOneWaterfall(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    const dbCallPatterns = [
        /prisma\.\w+\./,
        /\.findFirst\(/,
        /\.findUnique\(/,
        /\.findMany\(/,
        /\.query\(/,
        /db\.\w+\./,
    ];

    // Find all .map(), .forEach(), for...of, for loops
    sourceFile.forEachDescendant((node) => {
        // Check for .map() and .forEach() callbacks
        if (Node.isCallExpression(node)) {
            const expr = node.getExpression();
            if (Node.isPropertyAccessExpression(expr)) {
                const methodName = expr.getName();
                if (methodName === 'map' || methodName === 'forEach') {
                    const args = node.getArguments();
                    if (args.length > 0) {
                        const callback = args[0];
                        const callbackText = callback.getText();

                        // Check if callback contains DB call
                        if (dbCallPatterns.some(p => p.test(callbackText))) {
                            violations.push({
                                line: node.getStartLineNumber(),
                                code: 'N_PLUS_ONE_WATERFALL',
                                symbol: methodName,
                                message: `N+1 query detected: Database call inside .${methodName}(). This executes N queries for N items. Use batch fetching or prisma's include/select instead.`,
                                severity: 'error',
                            });
                        }
                    }
                }
            }
        }

        // Check for...of loops
        if (Node.isForOfStatement(node)) {
            const body = node.getStatement();
            const bodyText = body.getText();

            if (dbCallPatterns.some(p => p.test(bodyText))) {
                violations.push({
                    line: node.getStartLineNumber(),
                    code: 'N_PLUS_ONE_WATERFALL',
                    symbol: 'for...of',
                    message: `N+1 query detected: Database call inside for...of loop. This executes N queries for N items. Batch your queries outside the loop.`,
                    severity: 'error',
                });
            }
        }
    });

    return violations;
}

// ============================================================
// RULE 3: GLOBAL_STATE_POLLUTION
// Detects mutable globals in serverless code
// ============================================================

/**
 * Check for mutable global state that persists across requests.
 */
export function checkGlobalState(sourceFile: SourceFile, filename: string): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Only check serverless paths (app/, api/, etc.)
    const isServerlessPath = /(?:^|[\\/])(?:app|api|pages\/api)[\\/]/.test(filename);
    if (!isServerlessPath) return violations;

    // Find top-level let/var declarations
    for (const stmt of sourceFile.getStatements()) {
        if (Node.isVariableStatement(stmt)) {
            const declarations = stmt.getDeclarations();
            const declKeyword = stmt.getDeclarationKind();

            // let and var can be mutated
            if (declKeyword === VariableDeclarationKind.Let || declKeyword === VariableDeclarationKind.Var) {
                for (const decl of declarations) {
                    const name = decl.getName();
                    const initializer = decl.getInitializer();

                    // Skip if it's a const-like pattern (e.g., let x = Object.freeze(...))
                    if (initializer) {
                        const initText = initializer.getText();
                        if (initText.includes('Object.freeze') || initText.includes('as const')) {
                            continue;
                        }
                    }

                    // Skip common safe patterns
                    if (name.startsWith('_') || name === 'prisma' || name === 'db') {
                        continue;
                    }

                    violations.push({
                        line: decl.getStartLineNumber(),
                        code: 'GLOBAL_STATE_POLLUTION',
                        symbol: name,
                        message: `Mutable global '${name}' in serverless code. This state persists across requests and can cause race conditions. Use 'const' or move to request scope.`,
                        severity: 'warning',
                    });
                }
            }
        }
    }

    return violations;
}

// ============================================================
// RULE 4: REDIRECT_IN_TRY_CATCH
// Detects redirect() calls inside try blocks (Next.js anti-pattern)
// ============================================================

/**
 * Check for redirect() calls inside try-catch blocks.
 * In Next.js, redirect() throws an exception that should not be caught.
 */
export function checkUnsafeRedirect(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    sourceFile.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
            const expr = node.getExpression();
            const callName = Node.isIdentifier(expr) ? expr.getText() : '';

            if (callName === 'redirect' || callName === 'permanentRedirect') {
                // Check if inside a try block
                let current = node.getParent();
                while (current) {
                    if (Node.isTryStatement(current)) {
                        violations.push({
                            line: node.getStartLineNumber(),
                            code: 'REDIRECT_IN_TRY_CATCH',
                            symbol: callName,
                            message: `${callName}() inside try-catch will be swallowed. Next.js redirect() throws NEXT_REDIRECT which should not be caught. Move redirect outside try-catch or re-throw the error.`,
                            severity: 'error',
                        });
                        break;
                    }
                    current = current.getParent();
                }
            }
        }
    });

    return violations;
}
