// src/core/analysis/types.ts
// Type definitions for the Detective Engine (Static Analysis Layer)

import { z } from 'zod';

// ============================================================
// CONTEXT EXTRACTION TYPES
// ============================================================

/**
 * Represents a parsed import statement with resolution info.
 */
export const ImportInfoSchema = z.object({
    line: z.number().describe('Line number of the import'),
    moduleSpecifier: z.string().describe('The raw import path (e.g., "./utils", "react")'),
    isRelative: z.boolean().describe('True if starts with ./ or ../'),
    resolvedPath: z.string().nullable().describe('Absolute path if resolved, null if external package'),
    namedImports: z.array(z.string()).describe('Named imports like { foo, bar }'),
    defaultImport: z.string().nullable().describe('Default import name if present'),
    namespaceImport: z.string().nullable().describe('Namespace import like * as Name'),
});
export type ImportInfo = z.infer<typeof ImportInfoSchema>;

/**
 * Framework-specific context about a file.
 */
export const FileContextSchema = z.object({
    isClientComponent: z.boolean().describe('Has "use client" directive'),
    isServerComponent: z.boolean().describe('RSC with no client directive'),
    isServerAction: z.boolean().describe('Has "use server" directive'),
    isRouteHandler: z.boolean().describe('Next.js API route (app/api/**/route.ts)'),
    isPageComponent: z.boolean().describe('Next.js page (page.tsx or pages/*.tsx)'),
    framework: z.enum(['nextjs-app', 'nextjs-pages', 'react', 'node', 'unknown']),
    routerType: z.enum(['app', 'pages', 'unknown']).describe('Next.js router type'),
});
export type FileContext = z.infer<typeof FileContextSchema>;

/**
 * Context violation - using wrong APIs for the component type.
 */
export const ContextViolationSchema = z.object({
    line: z.number(),
    code: z.enum([
        'CLIENT_HOOK_IN_SERVER',      // useState/useEffect in RSC
        'SERVER_ONLY_IN_CLIENT',      // server-only import in client component
        'ASYNC_CLIENT_COMPONENT',     // async function in client component
        'MISSING_USE_CLIENT',         // Uses hooks but no directive
        'WRONG_EXPORT_PATTERN',       // export default in route handler
    ]),
    symbol: z.string().describe('The problematic symbol (e.g., "useState")'),
    message: z.string().describe('Human-readable explanation'),
    severity: z.enum(['error', 'warning']),
});
export type ContextViolation = z.infer<typeof ContextViolationSchema>;

/**
 * Database schema context (Prisma).
 */
export const PrismaModelSchema = z.object({
    name: z.string(),
    fields: z.array(z.object({
        name: z.string(),
        type: z.string(),
        isRelation: z.boolean(),
        relationName: z.string().nullable(),
        onDelete: z.enum(['Cascade', 'SetNull', 'Restrict', 'NoAction', 'SetDefault']).nullable(),
    })),
});
export type PrismaModel = z.infer<typeof PrismaModelSchema>;

/**
 * Package.json dependency info.
 */
export const DependencyInfoSchema = z.object({
    name: z.string(),
    version: z.string(),
    isDev: z.boolean(),
});
export type DependencyInfo = z.infer<typeof DependencyInfoSchema>;

// ============================================================
// ANALYSIS REPORT (The Detective's Output)
// ============================================================

/**
 * The complete analysis report for a single file.
 * This is what gets injected into the LLM prompt.
 */
export const AnalysisReportSchema = z.object({
    file: z.string().describe('Relative file path'),

    // File Context
    context: FileContextSchema.describe('Framework-specific context'),

    // Imports Analysis
    imports: z.array(ImportInfoSchema).describe('All imports in the file'),

    // Context Violations (the good stuff)
    violations: z.array(ContextViolationSchema).describe('Framework rule violations'),

    // Metadata for LLM grounding
    metadata: z.object({
        totalLines: z.number(),
        hasTypeScript: z.boolean(),
        hasJSX: z.boolean(),
        exportedSymbols: z.array(z.string()).describe('Named exports for cross-file analysis'),
    }),
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

/**
 * Project-wide context for grounding the LLM.
 */
export const ProjectContextSchema = z.object({
    // Dependencies with versions (prevents API hallucination)
    dependencies: z.array(DependencyInfoSchema),

    // Prisma schema if present (for cascade/relation warnings)
    prismaModels: z.array(PrismaModelSchema).optional(),

    // Framework detection
    framework: z.enum(['nextjs-app', 'nextjs-pages', 'react', 'node', 'unknown']),

    // TypeScript config hints
    tsConfig: z.object({
        strict: z.boolean(),
        target: z.string().nullable(),
    }).optional(),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
