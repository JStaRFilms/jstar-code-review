// test/test-detective.ts
// Local test script to verify the Detective Engine works correctly
// Usage: npx tsx test/test-detective.ts

import * as fs from 'fs';
import * as path from 'path';
import { analyzeFile } from '../src/core/analysis/index.js';

const FIXTURES_DIR = path.join(process.cwd(), 'test', 'fixtures');

interface TestCase {
    file: string;
    expectedViolations: string[];
    description: string;
}

const TEST_CASES: TestCase[] = [
    // === ORIGINAL RULES ===
    {
        file: 'server-with-hook.tsx',
        expectedViolations: ['CLIENT_HOOK_IN_SERVER'],  // File in app/ without "use client" = Server Component
        description: 'Server Component using useState/useEffect (invalid)',
    },
    {
        file: 'client-with-server-import.tsx',
        expectedViolations: ['SERVER_ONLY_IN_CLIENT'],
        description: 'Client Component importing next/headers',
    },
    {
        file: 'route-with-default-export.ts',
        expectedViolations: ['WRONG_EXPORT_PATTERN'],
        description: 'Route Handler using export default',
    },
    {
        file: 'valid-client-component.tsx',
        expectedViolations: [],
        description: 'Valid Client Component (no violations)',
    },
    // === GOD MODE RULES ===
    {
        file: 'floating-promise.ts',
        expectedViolations: ['FLOATING_PROMISE'],
        description: 'Async call without await/return (floating promise)',
    },
    {
        file: 'n-plus-one.ts',
        expectedViolations: ['N_PLUS_ONE_WATERFALL'],
        description: 'Database call inside loop/map (N+1 query)',
    },
    {
        file: 'toxic-args.tsx',
        expectedViolations: ['TOXIC_SERVER_ACTION_ARG'],
        description: 'Non-serializable args (Date/Map) in client component',
    },
    {
        file: 'secret-leak.tsx',
        expectedViolations: ['SECRET_LEAK_CLIENT'],
        description: 'Non-NEXT_PUBLIC env var in client component',
    },
    {
        file: 'redirect-try-catch.ts',
        expectedViolations: ['REDIRECT_IN_TRY_CATCH'],
        description: 'redirect() inside try-catch block',
    },
];

console.log('═══════════════════════════════════════════════════════════');
console.log('  🔍 DETECTIVE ENGINE TEST SUITE');
console.log('═══════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

for (const testCase of TEST_CASES) {
    const filePath = path.join(FIXTURES_DIR, testCase.file);

    if (!fs.existsSync(filePath)) {
        console.log(`❌ SKIP: ${testCase.file} (file not found)`);
        failed++;
        continue;
    }

    const code = fs.readFileSync(filePath, 'utf-8');
    // Use app/ prefix for route handler to trigger the route detection
    const analysisPath = testCase.file === 'route-with-default-export.ts'
        ? 'app/api/test/route.ts'
        : `app/${testCase.file}`;
    const report = analyzeFile(code, analysisPath);

    const foundCodes = report.violations.map(v => v.code);
    const allExpectedFound = testCase.expectedViolations.every(exp => foundCodes.includes(exp as any));
    const noUnexpected = testCase.expectedViolations.length === 0
        ? report.violations.length === 0
        : true;

    const success = allExpectedFound && noUnexpected;

    if (success) {
        console.log(`✅ PASS: ${testCase.file}`);
        console.log(`   ${testCase.description}`);
        if (report.violations.length > 0) {
            report.violations.forEach(v => {
                console.log(`   → Line ${v.line}: [${v.code}] ${v.symbol}`);
            });
        } else {
            console.log(`   → No violations (as expected)`);
        }
        passed++;
    } else {
        console.log(`❌ FAIL: ${testCase.file}`);
        console.log(`   Expected: ${testCase.expectedViolations.join(', ') || 'none'}`);
        console.log(`   Found: ${foundCodes.join(', ') || 'none'}`);
        failed++;
    }
    console.log('');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════\n');

// Determinism test: Run 5 times, output should be identical
console.log('🔄 DETERMINISM TEST (5 runs)...');
const deterministicFile = path.join(FIXTURES_DIR, 'server-with-hook.tsx');
const deterministicCode = fs.readFileSync(deterministicFile, 'utf-8');

const results: string[] = [];
for (let i = 0; i < 5; i++) {
    const report = analyzeFile(deterministicCode, 'app/test.tsx');
    results.push(JSON.stringify(report));
}

const allIdentical = results.every(r => r === results[0]);
if (allIdentical) {
    console.log('✅ DETERMINISM PASS: All 5 runs produced identical output');
} else {
    console.log('❌ DETERMINISM FAIL: Outputs differ between runs');
}

process.exit(failed > 0 ? 1 : 0);
