// src/core/analysis/rules/context-logic.ts
// God Mode Rules 9-12: Context Intelligence
// Detects issues that require project-wide context awareness.

import { SourceFile, Node } from 'ts-morph';
import type { ContextViolation } from '../types.js';
import { SchemaLoader, type SchemaMap } from '../context/schema-loader.js';

// ============================================================
// RULE 9: SCHEMA_DRIFT
// Detects Prisma queries selecting fields not in schema
// ============================================================

/**
 * Check for schema drift (query fields not in Prisma schema).
 * Requires schema to be loaded via SchemaLoader.
 */
export function checkSchemaDrift(
    sourceFile: SourceFile,
    schemaMap: SchemaMap
): ContextViolation[] {
    const violations: ContextViolation[] = [];

    if (schemaMap.size === 0) return violations; // No schema loaded, skip

    const fullText = sourceFile.getFullText();

    // Match prisma.model.find*({ select: { field1, field2 } })
    // This is a simplified regex-based approach
    const prismaCallRegex = /prisma\.(\w+)\.(?:findFirst|findUnique|findMany)\s*\(\s*\{[^}]*select\s*:\s*\{([^}]+)\}/g;

    let match: RegExpExecArray | null;
    while ((match = prismaCallRegex.exec(fullText)) !== null) {
        const modelName = match[1];
        const selectBlock = match[2];

        // Capitalize model name for schema lookup (prisma.user -> User)
        const schemaModelName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
        const model = schemaMap.get(schemaModelName);

        if (!model) continue; // Model not found in schema, skip

        // Parse select fields
        const fieldNames = selectBlock
            .split(',')
            .map(f => f.trim().split(':')[0].trim())
            .filter(f => f && !f.startsWith('//'));

        const schemaFields = new Set(model.fields.map(f => f.name));

        for (const fieldName of fieldNames) {
            if (!schemaFields.has(fieldName)) {
                // Find line number
                const upToMatch = fullText.substring(0, match.index);
                const lineNumber = (upToMatch.match(/\n/g) || []).length + 1;

                violations.push({
                    line: lineNumber,
                    code: 'SCHEMA_DRIFT',
                    symbol: `${schemaModelName}.${fieldName}`,
                    message: `Field '${fieldName}' selected on '${schemaModelName}' but not found in Prisma schema. Was it renamed or removed?`,
                    severity: 'error',
                });
            }
        }
    }

    return violations;
}

// ============================================================
// RULE 10: SEQUENTIAL_FETCH_OPPORTUNITY
// Detects consecutive awaits that could be parallelized
// ============================================================

/**
 * Check for sequential fetches that could be parallel.
 * Detects consecutive await statements with no dependency.
 */
export function checkSequentialFetch(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Find all await expressions
    const awaitNodes: { node: Node; line: number; varName: string | null; usedVars: string[] }[] = [];

    sourceFile.forEachDescendant((node) => {
        if (Node.isAwaitExpression(node)) {
            const parent = node.getParent();
            let varName: string | null = null;

            // Check if result is assigned to a variable
            if (parent && Node.isVariableDeclaration(parent)) {
                varName = parent.getName();
            }

            // Extract referenced variable names from the await expression
            const awaitText = node.getText();
            const usedVars = extractVariableReferences(awaitText);

            awaitNodes.push({
                node,
                line: node.getStartLineNumber(),
                varName,
                usedVars,
            });
        }
    });

    // Check for consecutive awaits (within same function scope)
    for (let i = 1; i < awaitNodes.length; i++) {
        const prev = awaitNodes[i - 1];
        const curr = awaitNodes[i];

        // Skip if on same line (already parallel)
        if (prev.line === curr.line) continue;

        // Skip if current uses prev's result
        if (prev.varName && curr.usedVars.includes(prev.varName)) continue;

        // Check if lines are consecutive (within 3 lines)
        if (curr.line - prev.line <= 3) {
            violations.push({
                line: prev.line,
                code: 'SEQUENTIAL_FETCH_OPPORTUNITY',
                symbol: 'await',
                message: `Sequential awaits at lines ${prev.line} and ${curr.line} appear independent. Consider using Promise.all() for parallel execution.`,
                severity: 'warning',
            });
        }
    }

    return violations;
}

function extractVariableReferences(text: string): string[] {
    // Simple extraction of variable names (identifiers)
    const matches = text.match(/\b[a-zA-Z_]\w*\b/g) || [];
    return matches.filter(m => !['await', 'async', 'const', 'let', 'var', 'new', 'true', 'false'].includes(m));
}

// ============================================================
// RULE 11: ORPHAN_RELATION_INCLUDE
// Detects Prisma includes for relations not in schema
// ============================================================

/**
 * Check for orphan relation includes (relation not in schema).
 */
export function checkOrphanIncludes(
    sourceFile: SourceFile,
    schemaMap: SchemaMap
): ContextViolation[] {
    const violations: ContextViolation[] = [];

    if (schemaMap.size === 0) return violations;

    const fullText = sourceFile.getFullText();

    // Match include: { relation: true } or include: { relation: { ... } }
    const includeRegex = /prisma\.(\w+)\.(?:findFirst|findUnique|findMany|create|update)\s*\([^)]*include\s*:\s*\{([^}]+)\}/g;

    let match: RegExpExecArray | null;
    while ((match = includeRegex.exec(fullText)) !== null) {
        const modelName = match[1];
        const includeBlock = match[2];

        const schemaModelName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
        const model = schemaMap.get(schemaModelName);

        if (!model) continue;

        // Get relation fields
        const relationFields = new Set(
            model.fields.filter(f => f.isRelation).map(f => f.name)
        );

        // Parse include keys
        const includeKeys = includeBlock
            .split(',')
            .map(i => i.trim().split(':')[0].trim())
            .filter(i => i && !i.startsWith('//'));

        for (const key of includeKeys) {
            if (!relationFields.has(key)) {
                const upToMatch = fullText.substring(0, match.index);
                const lineNumber = (upToMatch.match(/\n/g) || []).length + 1;

                violations.push({
                    line: lineNumber,
                    code: 'ORPHAN_RELATION_INCLUDE',
                    symbol: `${schemaModelName}.${key}`,
                    message: `Include '${key}' on '${schemaModelName}' but no such relation in Prisma schema. This will cause a runtime error.`,
                    severity: 'error',
                });
            }
        }
    }

    return violations;
}

// ============================================================
// RULE 12: HARDCODED_TEST_ID
// Detects hardcoded UUIDs and Date.now() in test/seed files
// ============================================================

/**
 * Check for hardcoded IDs in test/seed files.
 * These often cause flaky tests or seed conflicts.
 */
export function checkHardcodedIds(sourceFile: SourceFile, filename: string): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Only check test/seed files
    const isTestFile = /(?:test|spec|seed|fixture)/i.test(filename);
    if (!isTestFile) return violations;

    const fullText = sourceFile.getFullText();

    // Check for UUID patterns
    const uuidRegex = /['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/gi;
    let uuidMatch: RegExpExecArray | null;

    while ((uuidMatch = uuidRegex.exec(fullText)) !== null) {
        const upToMatch = fullText.substring(0, uuidMatch.index);
        const lineNumber = (upToMatch.match(/\n/g) || []).length + 1;

        violations.push({
            line: lineNumber,
            code: 'HARDCODED_TEST_ID',
            symbol: 'UUID',
            message: `Hardcoded UUID in test/seed file. Use a UUID generator or factory for deterministic test IDs.`,
            severity: 'warning',
        });
    }

    // Check for Date.now() in ID context
    if (/id:\s*Date\.now\(\)/.test(fullText) || /id:\s*`\$\{Date\.now\(\)\}`/.test(fullText)) {
        const match = fullText.match(/id:\s*Date\.now\(\)/);
        if (match) {
            const upToMatch = fullText.substring(0, match.index);
            const lineNumber = (upToMatch.match(/\n/g) || []).length + 1;

            violations.push({
                line: lineNumber,
                code: 'HARDCODED_TEST_ID',
                symbol: 'Date.now()',
                message: `Using Date.now() for ID in test/seed. This causes unique IDs on every run, making tests harder to debug. Use a stable ID generator.`,
                severity: 'warning',
            });
        }
    }

    return violations;
}
