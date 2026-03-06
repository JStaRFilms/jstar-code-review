import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { scanFileContent } from "../scripts/core/deterministic-audit";

const FIXTURES_DIR = path.join(process.cwd(), "test", "fixtures");

interface TestCase {
    fixture: string;
    normalizedPath: string;
    expectedRuleIds: string[];
}

const TEST_CASES: TestCase[] = [
    {
        fixture: "secret-leak.tsx",
        normalizedPath: "app/secret-leak.tsx",
        expectedRuleIds: ["SEC-005"],
    },
    {
        fixture: "dangerous-html.tsx",
        normalizedPath: "app/dangerous-html.tsx",
        expectedRuleIds: ["SEC-004"],
    },
    {
        fixture: "unsafe-query.ts",
        normalizedPath: "src/data/unsafe-query.ts",
        expectedRuleIds: ["SEC-003"],
    },
    {
        fixture: "misplaced-use-client.tsx",
        normalizedPath: "app/misplaced-use-client.tsx",
        expectedRuleIds: ["ARCH-001"],
    },
    {
        fixture: "valid-client-component.tsx",
        normalizedPath: "app/valid-client-component.tsx",
        expectedRuleIds: [],
    },
];

let passed = 0;

for (const testCase of TEST_CASES) {
    const fixturePath = path.join(FIXTURES_DIR, testCase.fixture);
    const content = fs.readFileSync(fixturePath, "utf-8");
    const findings = scanFileContent(content, testCase.normalizedPath);
    const foundRuleIds = findings.map((finding) => finding.ruleId);

    assert.deepEqual(
        [...new Set(foundRuleIds)].sort(),
        [...new Set(testCase.expectedRuleIds)].sort(),
        `Unexpected rule set for ${testCase.fixture}`,
    );

    passed++;
}

const deterministicFixture = fs.readFileSync(path.join(FIXTURES_DIR, "secret-leak.tsx"), "utf-8");
const outputs = Array.from({ length: 5 }, () =>
    JSON.stringify(scanFileContent(deterministicFixture, "app/secret-leak.tsx")),
);
assert(outputs.every((output) => output === outputs[0]), "scanFileContent should be deterministic across runs");

console.log(`Detective tests passed: ${passed} cases + determinism check.`);
