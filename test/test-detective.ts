import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { scanFileContent } from "../scripts/core/deterministic-audit";

const FIXTURES_DIR = path.join(process.cwd(), "test", "fixtures");

interface TestCase {
    fixture?: string;
    name?: string;
    content?: string;
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
        name: "standalone api key assignment",
        content: ['const apiKey = "abc123def456";', ""].join("\n"),
        normalizedPath: "src/standalone-secret.ts",
        expectedRuleIds: ["SEC-001"],
    },
    {
        name: "api version string does not trigger secret rule",
        content: ['const apiVersion = "my-service-v1";', ""].join("\n"),
        normalizedPath: "src/non-secret-version.ts",
        expectedRuleIds: [],
    },
    {
        name: "commented fake secret does not trigger secret rule",
        content: ['// token = "aaaaaaaaaa";', ""].join("\n"),
        normalizedPath: "src/commented-secret.ts",
        expectedRuleIds: [],
    },
    {
        name: "sample secret inside a string literal does not trigger secret rule",
        content: ['const docs = "apiKey = \\"abc123def4567890\\"";', ""].join("\n"),
        normalizedPath: "src/stringified-secret-example.ts",
        expectedRuleIds: [],
    },
    {
        name: "commented eval call does not trigger dynamic execution rule",
        content: ["// eval(userInput)", ""].join("\n"),
        normalizedPath: "src/commented-eval.ts",
        expectedRuleIds: [],
    },
    {
        name: "dangerous html text inside string literal does not trigger sink rule",
        content: ['const docs = "dangerouslySetInnerHTML={{ __html: value }}";', ""].join("\n"),
        normalizedPath: "app/stringified-dangerous-html.tsx",
        expectedRuleIds: [],
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
    {
        name: "inline block comment before use client",
        content: ['/* Banner comment */ "use client";', "", "export const value = 1;", ""].join("\n"),
        normalizedPath: "app/commented-client-component.tsx",
        expectedRuleIds: [],
    },
    {
        name: "shebang before use client",
        content: ['#!/usr/bin/env node', '"use client";', "", "export const value = 1;", ""].join("\n"),
        normalizedPath: "app/shebang-client-component.ts",
        expectedRuleIds: [],
    },
    {
        name: "commented client file still triggers env leak rule",
        content: [
            "/* Multi-line",
            " * header comment",
            " */",
            '"use client";',
            "",
            "export const secret = process.env.INTERNAL_TOKEN;",
            "",
        ].join("\n"),
        normalizedPath: "app/commented-secret-leak.tsx",
        expectedRuleIds: ["SEC-005"],
    },
    {
        name: "commented env reference in client file stays inert",
        content: [
            '"use client";',
            "",
            "// process.env.INTERNAL_TOKEN",
            "",
        ].join("\n"),
        normalizedPath: "app/commented-env-reference.tsx",
        expectedRuleIds: [],
    },
    {
        name: "unclosed block comment keeps remaining lines inert",
        content: [
            "/* unclosed comment",
            '"use client";',
            "export const secret = process.env.INTERNAL_TOKEN;",
            "",
        ].join("\n"),
        normalizedPath: "app/unclosed-comment.tsx",
        expectedRuleIds: [],
    },
];

let passed = 0;

for (const testCase of TEST_CASES) {
    const content =
        testCase.content ??
        fs.readFileSync(path.join(FIXTURES_DIR, testCase.fixture ?? ""), "utf-8");
    const findings = scanFileContent(content, testCase.normalizedPath);
    const foundRuleIds = findings.map((finding) => finding.ruleId);
    const label = testCase.name ?? testCase.fixture ?? testCase.normalizedPath;

    assert.deepEqual(
        [...new Set(foundRuleIds)].sort(),
        [...new Set(testCase.expectedRuleIds)].sort(),
        `Unexpected rule set for ${label}`,
    );

    passed++;
}

const misplacedUseClient = fs.readFileSync(path.join(FIXTURES_DIR, "misplaced-use-client.tsx"), "utf-8");
const misplacedFinding = scanFileContent(misplacedUseClient, "app/misplaced-use-client.tsx").find(
    (finding) => finding.ruleId === "ARCH-001",
);
assert.equal(misplacedFinding?.line, 3, 'ARCH-001 should point at the misplaced "use client" directive line');

const deterministicFixture = fs.readFileSync(path.join(FIXTURES_DIR, "secret-leak.tsx"), "utf-8");
const outputs = Array.from({ length: 5 }, () =>
    JSON.stringify(scanFileContent(deterministicFixture, "app/secret-leak.tsx")),
);
assert(outputs.every((output) => output === outputs[0]), "scanFileContent should be deterministic across runs");

console.log(`Detective tests passed: ${passed} cases + determinism check.`);
