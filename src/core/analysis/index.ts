// src/core/analysis/index.ts
// Public API for the Detective Engine

export {
    analyzeFile,
    analyzeFilesFromDiff,
    buildProjectContext,
    formatReportsForLLM,
} from './engine.js';

export type {
    AnalysisReport,
    FileContext,
    ImportInfo,
    ContextViolation,
    ProjectContext,
    DependencyInfo,
    PrismaModel,
} from './types.js';

export {
    parsePackageJson,
    getAllDependencies,
    hasDependency,
    getDependencyVersion,
    detectFramework,
    getApiHints,
} from './utils/package-parser.js';

export type { PackageJson } from './utils/package-parser.js';
