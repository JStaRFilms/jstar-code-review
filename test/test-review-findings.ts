import assert from "node:assert/strict";
import { mergeFindings } from "../scripts/core/review-findings";
import { FileFinding } from "../scripts/types";

const primary: FileFinding[] = [
    {
        file: "src/example.ts",
        severity: "P2_MEDIUM",
        issues: [
            {
                title: "Duplicate issue",
                description: "LLM description",
                line: 12,
                fixPrompt: "Use the LLM recommendation.",
                confidenceScore: 3,
                source: "llm",
            },
        ],
    },
];

const secondary: FileFinding[] = [
    {
        file: "src/example.ts",
        severity: "P1_HIGH",
        issues: [
            {
                title: "Duplicate issue",
                description: "Deterministic description",
                line: 12,
                fixPrompt: "Use the deterministic recommendation.",
                confidenceScore: 5,
                ruleId: "SEC-001",
                source: "deterministic",
            },
            {
                title: "Another issue",
                description: "Independent issue",
                line: 20,
                fixPrompt: "Apply the second fix.",
                confidenceScore: 4,
                source: "llm",
            },
        ],
    },
];

const merged = mergeFindings(primary, secondary);
assert.equal(merged.length, 1, "Expected findings to stay grouped by file");
assert.equal(merged[0].severity, "P1_HIGH", "Expected higher severity to win");
assert.equal(merged[0].issues.length, 2, "Expected duplicate title+line issues to be deduplicated");

const duplicateIssue = merged[0].issues.find((issue) => issue.title === "Duplicate issue");
assert.equal(duplicateIssue?.ruleId, "SEC-001", "Expected merged duplicate to preserve deterministic rule metadata");
assert.equal(duplicateIssue?.source, "deterministic", "Expected deterministic issue to win tie-breaking");
assert.equal(duplicateIssue?.confidenceScore, 5, "Expected merged duplicate to keep the highest confidence score");

console.log("Review findings tests passed: merge dedupe.");
