// src/core/analysis/project-analyzer.ts
// Option B: Full Project Context Analysis
// Enables cross-file type resolution for advanced detection

import { Project, SourceFile, Node, SyntaxKind, Type } from 'ts-morph';
import type {
    AnalysisReport,
    FileContext,
    ImportInfo,
    ContextViolation,
} from './types.js';

/**
 * ProjectAnalyzer provides cross-file analysis by loading the full project context.
 * This enables detection of issues like:
 * - Using async server actions in Client Components
 * - Calling database functions from client code
 * - Type mismatches across module boundaries
 */
export class ProjectAnalyzer {
    private project: Project;
    private fileCache: Map<string, SourceFile> = new Map();

    constructor(tsconfigPath?: string) {
        this.project = new Project({
            tsConfigFilePath: tsconfigPath,
            skipAddingFilesFromTsConfig: false, // Load all files from tsconfig
            compilerOptions: tsconfigPath ? undefined : {
                target: 99, // ESNext
                jsx: 4,     // React JSX
                strict: true,
                moduleResolution: 99, // Bundler
                esModuleInterop: true,
            },
        });
    }

    /**
     * Add source files to the project for analysis.
     * In a real scenario, these would be loaded from disk.
     */
    addSourceFile(filename: string, code: string): SourceFile {
        // Check cache first
        if (this.fileCache.has(filename)) {
            const existing = this.fileCache.get(filename)!;
            // Update content if it changed
            existing.replaceWithText(code);
            return existing;
        }

        const sourceFile = this.project.createSourceFile(filename, code, { overwrite: true });
        this.fileCache.set(filename, sourceFile);
        return sourceFile;
    }

    /**
     * Analyze a file with full project context.
     * Can resolve imports and track types across files.
     */
    analyzeWithContext(filename: string): CrossFileAnalysis {
        const sourceFile = this.fileCache.get(filename);
        if (!sourceFile) {
            return {
                file: filename,
                serverActionCalls: [],
                databaseAccess: [],
                crossFileViolations: [],
            };
        }

        const analysis: CrossFileAnalysis = {
            file: filename,
            serverActionCalls: [],
            databaseAccess: [],
            crossFileViolations: [],
        };

        // Check if this is a client component
        const isClientComponent = this.isClientComponent(sourceFile);

        // Analyze all call expressions
        sourceFile.forEachDescendant((node) => {
            if (Node.isCallExpression(node)) {
                const expression = node.getExpression();

                // Try to resolve the called function
                if (Node.isIdentifier(expression)) {
                    const symbol = expression.getSymbol();
                    if (symbol) {
                        const declarations = symbol.getDeclarations();
                        for (const decl of declarations) {
                            // Check if imported from another file
                            if (Node.isImportSpecifier(decl)) {
                                const importDecl = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
                                if (importDecl) {
                                    const moduleSpecifier = importDecl.getModuleSpecifierValue();

                                    // Try to resolve the source file
                                    const resolvedFile = this.resolveImport(sourceFile, moduleSpecifier);
                                    if (resolvedFile) {
                                        // Check what the imported function does
                                        const funcInfo = this.analyzeFunctionInFile(
                                            resolvedFile,
                                            expression.getText()
                                        );

                                        if (funcInfo.isAsync && funcInfo.hasServerDirective && isClientComponent) {
                                            analysis.serverActionCalls.push({
                                                line: node.getStartLineNumber(),
                                                functionName: expression.getText(),
                                                sourceFile: resolvedFile.getFilePath(),
                                            });

                                            analysis.crossFileViolations.push({
                                                line: node.getStartLineNumber(),
                                                code: 'SERVER_ACTION_IN_CLIENT',
                                                symbol: expression.getText(),
                                                message: `'${expression.getText()}' is a Server Action (from '${moduleSpecifier}') and cannot be directly called in a Client Component. Pass it as a prop or use it in a form action.`,
                                                severity: 'error',
                                            });
                                        }

                                        if (funcInfo.accessesDatabase && isClientComponent) {
                                            analysis.databaseAccess.push({
                                                line: node.getStartLineNumber(),
                                                functionName: expression.getText(),
                                                sourceFile: resolvedFile.getFilePath(),
                                            });

                                            analysis.crossFileViolations.push({
                                                line: node.getStartLineNumber(),
                                                code: 'DATABASE_ACCESS_IN_CLIENT',
                                                symbol: expression.getText(),
                                                message: `'${expression.getText()}' accesses the database and cannot be called from a Client Component.`,
                                                severity: 'error',
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        return analysis;
    }

    /**
     * Check if a source file is a client component.
     */
    private isClientComponent(sourceFile: SourceFile): boolean {
        const fullText = sourceFile.getFullText();
        return /^['"]use client['"];?/m.test(fullText);
    }

    /**
     * Resolve an import specifier to its source file.
     */
    private resolveImport(fromFile: SourceFile, moduleSpecifier: string): SourceFile | null {
        // Try to find the file in the project
        const importDeclarations = fromFile.getImportDeclarations();
        for (const importDecl of importDeclarations) {
            if (importDecl.getModuleSpecifierValue() === moduleSpecifier) {
                const moduleSourceFile = importDecl.getModuleSpecifierSourceFile();
                return moduleSourceFile ?? null;
            }
        }
        return null;
    }

    /**
     * Analyze a function in a file to determine its characteristics.
     */
    private analyzeFunctionInFile(sourceFile: SourceFile, functionName: string): FunctionInfo {
        const info: FunctionInfo = {
            isAsync: false,
            hasServerDirective: false,
            accessesDatabase: false,
        };

        // Check for "use server" directive at file level
        const fullText = sourceFile.getFullText();
        info.hasServerDirective = /^['"]use server['"];?/m.test(fullText);

        // Find the function
        const func = sourceFile.getFunction(functionName);
        if (func) {
            info.isAsync = func.isAsync();

            // Check if function body accesses database patterns
            const funcText = func.getFullText();
            info.accessesDatabase =
                /prisma\./i.test(funcText) ||
                /db\./i.test(funcText) ||
                /\.query\(/i.test(funcText) ||
                /\.execute\(/i.test(funcText) ||
                /sql`/i.test(funcText);
        }

        // Also check exported variable declarations (arrow functions)
        for (const varStmt of sourceFile.getVariableStatements()) {
            if (varStmt.isExported()) {
                for (const decl of varStmt.getDeclarations()) {
                    if (decl.getName() === functionName) {
                        const initializer = decl.getInitializer();
                        if (initializer) {
                            const initText = initializer.getText();
                            info.isAsync = /async\s*\(/.test(initText) || /async\s*\w+\s*=>/.test(initText);
                            info.accessesDatabase =
                                /prisma\./i.test(initText) ||
                                /db\./i.test(initText) ||
                                /\.query\(/i.test(initText);
                        }
                    }
                }
            }
        }

        return info;
    }

    /**
     * Get diagnostics for type errors (bonus feature).
     */
    getTypeErrors(): TypeErrorInfo[] {
        const errors: TypeErrorInfo[] = [];
        const diagnostics = this.project.getPreEmitDiagnostics();

        for (const diag of diagnostics) {
            const sourceFile = diag.getSourceFile();
            if (sourceFile) {
                errors.push({
                    file: sourceFile.getFilePath(),
                    line: diag.getLineNumber() ?? 0,
                    message: diag.getMessageText().toString(),
                    code: diag.getCode(),
                });
            }
        }

        return errors;
    }

    /**
     * Clear the project cache.
     */
    clear(): void {
        this.fileCache.clear();
        for (const sourceFile of this.project.getSourceFiles()) {
            this.project.removeSourceFile(sourceFile);
        }
    }
}

// ============================================================
// TYPES
// ============================================================

export interface CrossFileAnalysis {
    file: string;
    serverActionCalls: FunctionCall[];
    databaseAccess: FunctionCall[];
    crossFileViolations: ContextViolation[];
}

export interface FunctionCall {
    line: number;
    functionName: string;
    sourceFile: string;
}

export interface FunctionInfo {
    isAsync: boolean;
    hasServerDirective: boolean;
    accessesDatabase: boolean;
}

export interface TypeErrorInfo {
    file: string;
    line: number;
    message: string;
    code: number;
}
