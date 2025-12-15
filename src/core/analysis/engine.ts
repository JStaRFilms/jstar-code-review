// src/core/analysis/engine.ts
// The Detective: Static Analysis Engine for J Star Reviewer
// Extracts ground truth from code to prevent LLM hallucinations
// God Mode: Now includes 11 additional deterministic detection rules.

import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import type {
    AnalysisReport,
    FileContext,
    ImportInfo,
    ContextViolation,
    ProjectContext,
} from './types.js';
import {
    parsePackageJson,
    getAllDependencies,
    detectFramework,
    getApiHints,
    type PackageJson,
} from './utils/package-parser.js';

// God Mode: Modular Rule Imports
import {
    checkFloatingPromise,
    checkNPlusOneWaterfall,
    checkGlobalState,
    checkUnsafeRedirect,
} from './rules/server-safety.js';
import {
    checkToxicArgs,
    checkSecretLeak,
    checkStaticMismatch,
} from './rules/next-arch.js';
import {
    checkSequentialFetch,
    checkHardcodedIds,
} from './rules/context-logic.js';
import { schemaLoader } from './context/schema-loader.js';

// ============================================================
// CLIENT HOOKS (React hooks that require 'use client')
// ============================================================
const CLIENT_HOOKS = new Set([
    'useState',
    'useEffect',
    'useRef',
    'useCallback',
    'useMemo',
    'useContext',
    'useReducer',
    'useLayoutEffect',
    'useImperativeHandle',
    'useDebugValue',
    'useDeferredValue',
    'useTransition',
    'useId',
    'useSyncExternalStore',
    'useInsertionEffect',
    // Common custom hooks that are client-only
    'useRouter',        // next/navigation (app router)
    'usePathname',
    'useSearchParams',
    'useParams',
    'useSelectedLayoutSegment',
    'useSelectedLayoutSegments',
    'useFormStatus',    // react-dom
    'useFormState',
    'useOptimistic',
]);

// ============================================================
// SERVER-ONLY IMPORTS
// ============================================================
const SERVER_ONLY_IMPORTS = new Set([
    'server-only',
    'next/headers',
    '@/lib/db',          // Common pattern for DB
    'prisma',
    '@prisma/client',
]);

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

/**
 * Analyze a single file and extract context for LLM grounding.
 * This is the core Detective function.
 */
export function analyzeFile(
    code: string,
    filename: string,
    packageJson?: PackageJson
): AnalysisReport {
    // Create an in-memory TypeScript project
    const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
            target: 99, // ESNext
            jsx: 4,     // React JSX
            strict: true,
        },
    });

    // Add the source file
    const sourceFile = project.createSourceFile(filename, code);

    // Extract all the context
    const context = extractFileContext(sourceFile, filename);
    const imports = extractImports(sourceFile);
    const violations = detectViolations(sourceFile, context, imports, filename);

    return {
        file: filename,
        context,
        imports,
        violations,
        metadata: {
            totalLines: sourceFile.getEndLineNumber(),
            hasTypeScript: filename.endsWith('.ts') || filename.endsWith('.tsx'),
            hasJSX: filename.endsWith('.tsx') || filename.endsWith('.jsx'),
            exportedSymbols: extractExports(sourceFile),
        },
    };
}

/**
 * Analyze multiple files from a diff.
 * Takes the raw diff content and parses out individual files.
 */
export function analyzeFilesFromDiff(
    fileDiffs: Array<{ filename: string; content: string }>,
    packageJson?: PackageJson
): AnalysisReport[] {
    return fileDiffs.map(({ filename, content }) =>
        analyzeFile(content, filename, packageJson)
    );
}

/**
 * Build project-wide context for LLM grounding.
 */
export function buildProjectContext(packageJsonContent: string): ProjectContext {
    const pkg = parsePackageJson(packageJsonContent);

    return {
        dependencies: getAllDependencies(pkg),
        framework: detectFramework(pkg),
    };
}

/**
 * Format analysis reports as a string for LLM injection.
 */
export function formatReportsForLLM(
    reports: AnalysisReport[],
    projectContext: ProjectContext,
    packageJson?: PackageJson
): string {
    const sections: string[] = [];

    // Project Context Header
    sections.push('=== PROJECT CONTEXT (GROUND TRUTH) ===');
    sections.push(`Framework: ${projectContext.framework}`);
    sections.push(`Dependencies: ${projectContext.dependencies.length} packages`);

    // API Hints
    if (packageJson) {
        const hints = getApiHints(packageJson);
        if (hints.size > 0) {
            sections.push('\n--- API VERSION HINTS (DO NOT USE DEPRECATED APIs) ---');
            for (const [pkg, hint] of hints) {
                sections.push(`${pkg}: ${hint}`);
            }
        }
    }

    // File Reports
    sections.push('\n=== FILE ANALYSIS REPORTS ===');

    for (const report of reports) {
        sections.push(`\n--- ${report.file} ---`);
        sections.push(`Type: ${report.context.isClientComponent ? 'Client Component' : report.context.isServerComponent ? 'Server Component' : 'Unknown'}`);

        if (report.violations.length > 0) {
            sections.push('\n⚠️ VIOLATIONS DETECTED (FACTUAL):');
            for (const v of report.violations) {
                sections.push(`  Line ${v.line}: [${v.code}] ${v.message}`);
            }
        }

        if (report.imports.length > 0) {
            sections.push(`\nImports: ${report.imports.map(i => i.moduleSpecifier).join(', ')}`);
        }
    }

    sections.push('\n=== END ANALYSIS ===');

    return sections.join('\n');
}

// ============================================================
// CONTEXT EXTRACTION
// ============================================================

function extractFileContext(sourceFile: SourceFile, filename: string): FileContext {
    const fullText = sourceFile.getFullText();

    // Check for directives
    const hasUseClient = /^['"]use client['"];?/m.test(fullText);
    const hasUseServer = /^['"]use server['"];?/m.test(fullText);

    // Determine router type from path (handles both /app/ and app/ at start)
    const isAppRouter = /(?:^|[\/\\])app[\/\\]/.test(filename);
    const isPagesRouter = /(?:^|[\/\\])pages[\/\\]/.test(filename);

    // Detect route handler (app/api/**/route.ts)
    const isRouteHandler = /(?:^|[\/\\])app[\/\\].*[\/\\]?route\.(ts|js)$/.test(filename);

    // Detect page (page.tsx or pages/*.tsx)
    const isPage = /[\/\\]page\.(tsx|jsx|ts|js)$/.test(filename) ||
        (isPagesRouter && !isRouteHandler);

    // Determine component type
    const isClient = hasUseClient;
    const isServer = !hasUseClient && (isAppRouter || hasUseServer);

    return {
        isClientComponent: isClient,
        isServerComponent: isServer,
        isServerAction: hasUseServer,
        isRouteHandler,
        isPageComponent: isPage,
        framework: isAppRouter ? 'nextjs-app' : isPagesRouter ? 'nextjs-pages' : 'unknown',
        routerType: isAppRouter ? 'app' : isPagesRouter ? 'pages' : 'unknown',
    };
}

// ============================================================
// IMPORT EXTRACTION
// ============================================================

function extractImports(sourceFile: SourceFile): ImportInfo[] {
    const imports: ImportInfo[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const isRelative = moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/');

        const namedImports = importDecl.getNamedImports().map(ni => ni.getName());
        const defaultImport = importDecl.getDefaultImport()?.getText() ?? null;
        const namespaceImport = importDecl.getNamespaceImport()?.getText() ?? null;

        imports.push({
            line: importDecl.getStartLineNumber(),
            moduleSpecifier,
            isRelative,
            resolvedPath: null, // Would need full project context to resolve
            namedImports,
            defaultImport,
            namespaceImport,
        });
    }

    return imports;
}

// ============================================================
// EXPORT EXTRACTION
// ============================================================

function extractExports(sourceFile: SourceFile): string[] {
    const exports: string[] = [];

    // Named exports
    for (const exportDecl of sourceFile.getExportDeclarations()) {
        for (const namedExport of exportDecl.getNamedExports()) {
            exports.push(namedExport.getName());
        }
    }

    // Export assignments (export default)
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (defaultExport) {
        exports.push('default');
    }

    // Exported variable declarations
    for (const varStmt of sourceFile.getVariableStatements()) {
        if (varStmt.isExported()) {
            for (const decl of varStmt.getDeclarations()) {
                exports.push(decl.getName());
            }
        }
    }

    // Exported functions
    for (const func of sourceFile.getFunctions()) {
        if (func.isExported()) {
            const name = func.getName();
            if (name) exports.push(name);
        }
    }

    return exports;
}

// ============================================================
// VIOLATION DETECTION (The Good Stuff)
// ============================================================

function detectViolations(
    sourceFile: SourceFile,
    context: FileContext,
    imports: ImportInfo[],
    filename: string = 'unknown'
): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // ==========================================================
    // ORIGINAL RULES (1-5)
    // ==========================================================

    // 1. Check for client hooks in server components
    if (context.isServerComponent) {
        violations.push(...detectClientHooksInServer(sourceFile));
    }

    // 2. Check for server-only imports in client components
    if (context.isClientComponent) {
        violations.push(...detectServerOnlyInClient(imports));
    }

    // 3. Check for async client components (invalid in React)
    if (context.isClientComponent) {
        violations.push(...detectAsyncClientComponent(sourceFile));
    }

    // 4. Check for hooks without 'use client' directive
    if (!context.isClientComponent && !context.isServerComponent) {
        violations.push(...detectMissingUseClient(sourceFile));
    }

    // 5. Check route handler export patterns
    if (context.isRouteHandler) {
        violations.push(...detectWrongRouteExports(sourceFile));
    }

    // ==========================================================
    // GOD MODE RULES (6-16)
    // ==========================================================

    // 6. FLOATING_PROMISE - Async calls not awaited
    violations.push(...checkFloatingPromise(sourceFile));

    // 7. N_PLUS_ONE_WATERFALL - DB call inside loop
    violations.push(...checkNPlusOneWaterfall(sourceFile));

    // 8. GLOBAL_STATE_POLLUTION - Mutable globals in serverless
    violations.push(...checkGlobalState(sourceFile, filename));

    // 9. REDIRECT_IN_TRY_CATCH - redirect() in try block
    violations.push(...checkUnsafeRedirect(sourceFile));

    // 10. TOXIC_SERVER_ACTION_ARG - Non-serializable args
    violations.push(...checkToxicArgs(sourceFile));

    // 11. SECRET_LEAK_CLIENT - Env vars in client
    violations.push(...checkSecretLeak(sourceFile));

    // 12. STATIC_EXPORT_MISMATCH - force-static conflicts
    violations.push(...checkStaticMismatch(sourceFile, filename));

    // 13. SEQUENTIAL_FETCH_OPPORTUNITY - Parallel optimization
    violations.push(...checkSequentialFetch(sourceFile));

    // 14. HARDCODED_TEST_ID - UUIDs in test files
    violations.push(...checkHardcodedIds(sourceFile, filename));

    // Note: SCHEMA_DRIFT and ORPHAN_RELATION_INCLUDE require schema context
    // and are run separately via runSchemaAwareRules()

    return violations;
}

/**
 * Detect React hooks being used in Server Components.
 */
function detectClientHooksInServer(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Find all call expressions
    sourceFile.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
            const expression = node.getExpression();
            if (Node.isIdentifier(expression)) {
                const name = expression.getText();
                if (CLIENT_HOOKS.has(name)) {
                    violations.push({
                        line: node.getStartLineNumber(),
                        code: 'CLIENT_HOOK_IN_SERVER',
                        symbol: name,
                        message: `'${name}' is a client hook and cannot be used in a Server Component. Add "use client" directive at the top of the file.`,
                        severity: 'error',
                    });
                }
            }
        }
    });

    return violations;
}

/**
 * Detect server-only imports in client components.
 */
function detectServerOnlyInClient(imports: ImportInfo[]): ContextViolation[] {
    const violations: ContextViolation[] = [];

    for (const imp of imports) {
        if (SERVER_ONLY_IMPORTS.has(imp.moduleSpecifier)) {
            violations.push({
                line: imp.line,
                code: 'SERVER_ONLY_IN_CLIENT',
                symbol: imp.moduleSpecifier,
                message: `'${imp.moduleSpecifier}' is server-only and cannot be imported in a Client Component. Move this logic to a Server Component or API route.`,
                severity: 'error',
            });
        }
    }

    return violations;
}

/**
 * Detect async function components marked as client.
 */
function detectAsyncClientComponent(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Look for async function declarations that look like components
    for (const func of sourceFile.getFunctions()) {
        if (func.isAsync() && func.isExported()) {
            const name = func.getName();
            // Component names start with uppercase
            if (name && /^[A-Z]/.test(name)) {
                violations.push({
                    line: func.getStartLineNumber(),
                    code: 'ASYNC_CLIENT_COMPONENT',
                    symbol: name,
                    message: `'${name}' is an async function but the file has "use client". Client Components cannot be async. Remove async or remove "use client".`,
                    severity: 'error',
                });
            }
        }
    }

    return violations;
}

/**
 * Detect hooks used without 'use client' directive.
 */
function detectMissingUseClient(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];
    let foundHook = false;
    let firstHookLine = 0;
    let firstHookName = '';

    sourceFile.forEachDescendant((node) => {
        if (!foundHook && Node.isCallExpression(node)) {
            const expression = node.getExpression();
            if (Node.isIdentifier(expression)) {
                const name = expression.getText();
                if (CLIENT_HOOKS.has(name)) {
                    foundHook = true;
                    firstHookLine = node.getStartLineNumber();
                    firstHookName = name;
                }
            }
        }
    });

    if (foundHook) {
        violations.push({
            line: firstHookLine,
            code: 'MISSING_USE_CLIENT',
            symbol: firstHookName,
            message: `This file uses '${firstHookName}' but doesn't have "use client" directive. In Next.js App Router, components using hooks must be Client Components.`,
            severity: 'warning',
        });
    }

    return violations;
}

/**
 * Detect wrong export patterns in route handlers.
 */
function detectWrongRouteExports(sourceFile: SourceFile): ContextViolation[] {
    const violations: ContextViolation[] = [];

    // Check for export default (wrong for App Router routes)
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (defaultExport) {
        const declaration = defaultExport.getDeclarations()[0];
        if (declaration) {
            violations.push({
                line: declaration.getStartLineNumber(),
                code: 'WRONG_EXPORT_PATTERN',
                symbol: 'default',
                message: 'Route handlers in App Router should use named exports (GET, POST, etc.), not export default.',
                severity: 'error',
            });
        }
    }

    return violations;
}
