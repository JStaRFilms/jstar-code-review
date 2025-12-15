// src/core/analysis/rules/index.ts
// Barrel file exporting all God Mode rules

// Server Safety Rules (1-4)
export {
    checkFloatingPromise,
    checkNPlusOneWaterfall,
    checkGlobalState,
    checkUnsafeRedirect,
} from './server-safety.js';

// Next.js Architecture Rules (5-8)
export {
    checkToxicArgs,
    checkSecretLeak,
    checkStaticMismatch,
} from './next-arch.js';

// Context Intelligence Rules (9-12)
export {
    checkSchemaDrift,
    checkSequentialFetch,
    checkOrphanIncludes,
    checkHardcodedIds,
} from './context-logic.js';
