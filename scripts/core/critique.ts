/**
 * Self-Critique Module
 * Second-pass validation to filter out false positives
 */

import { generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import chalk from "chalk";
import { Logger } from "../utils/logger";
import { Config } from "../config";
import { FileFinding, ReviewIssue } from "../types";

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

interface CritiqueResult {
    issueTitle: string;
    verdict: 'VALID' | 'FALSE_POSITIVE' | 'NEEDS_CONTEXT';
    reason: string;
}

interface CritiqueResponse {
    results: CritiqueResult[];
}

/**
 * Runs a self-critique pass on the initial findings.
 * Returns filtered findings with only validated issues.
 */
export async function critiqueFindings(
    findings: FileFinding[],
    diff: string
): Promise<FileFinding[]> {
    // Collect all issues across all files for batch critique
    const allIssues: { file: string; issue: ReviewIssue; index: number }[] = [];
    findings.forEach((f, fIdx) => {
        f.issues.forEach((issue, iIdx) => {
            allIssues.push({ file: f.file, issue, index: fIdx * 1000 + iIdx });
        });
    });

    if (allIssues.length === 0) {
        return findings;
    }

    Logger.info(chalk.blue("\n🔍 Self-Critique Pass: Validating findings...\n"));

    // Build the critique prompt
    const issueList = allIssues.map((item, idx) =>
        `[${idx}] File: ${item.file}\n    Title: ${item.issue.title}\n    Description: ${item.issue.description}`
    ).join("\n\n");

    const systemPrompt = `You are a code review validator. Your job is to filter out FALSE POSITIVES.

For each issue below, decide:
- VALID: This is a real problem that should be reported
- FALSE_POSITIVE: This is NOT a real issue (test mock, intentional pattern, already handled, etc.)
- NEEDS_CONTEXT: Can't determine without more code context (treat as valid)

Return JSON with this structure:
{
  "results": [
    { "issueTitle": "...", "verdict": "VALID" | "FALSE_POSITIVE" | "NEEDS_CONTEXT", "reason": "..." }
  ]
}

IMPORTANT:
- Be SKEPTICAL. If the code looks intentional, it's probably not a bug.
- Test files, mocks, and stubs are NOT bugs.
- "Missing error handling" in utility modules may be intentional.
- Return ONLY valid JSON.`;

    const userPrompt = `ORIGINAL DIFF:
\`\`\`
${diff.slice(0, 4000)}
\`\`\`

ISSUES TO VALIDATE:
${issueList}`;

    try {
        const { text } = await generateText({
            model: groq(Config.CRITIQUE_MODEL_NAME),
            system: systemPrompt,
            prompt: userPrompt,
            temperature: 0.1,
        });

        // Parse critique response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            Logger.warn(chalk.yellow("   ⚠️ Could not parse critique response, keeping all issues"));
            return findings;
        }

        let response: CritiqueResponse;
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            // Validate structure
            if (!parsed || !Array.isArray(parsed.results)) {
                throw new Error("Invalid response structure");
            }
            response = parsed;
        } catch (parseError) {
            Logger.warn(chalk.yellow("   ⚠️ Invalid JSON from critique, keeping all issues"));
            return findings;
        }

        // Build a map of verdicts by title
        const verdictMap = new Map<string, CritiqueResult>();
        for (const result of response.results) {
            verdictMap.set(result.issueTitle.toLowerCase(), result);
        }

        // Filter findings
        const filteredFindings: FileFinding[] = [];
        let removedCount = 0;

        for (const finding of findings) {
            const validIssues: ReviewIssue[] = [];

            for (const issue of finding.issues) {
                const verdict = verdictMap.get(issue.title.toLowerCase());

                if (verdict?.verdict === 'FALSE_POSITIVE') {
                    removedCount++;
                    Logger.info(chalk.dim(`   ❌ Removed: "${issue.title}" (${verdict.reason})`));
                } else {
                    validIssues.push(issue);
                    if (verdict?.verdict === 'VALID') {
                        Logger.info(chalk.green(`   ✓ Kept: "${issue.title}"`));
                    }
                }
            }

            if (validIssues.length > 0) {
                filteredFindings.push({
                    ...finding,
                    issues: validIssues,
                    // Upgrade to LGTM if no issues remain? No, keep severity for record
                });
            } else if (finding.issues.length > 0) {
                // All issues were false positives - mark as LGTM
                filteredFindings.push({
                    ...finding,
                    severity: 'LGTM',
                    issues: []
                });
            } else {
                filteredFindings.push(finding);
            }
        }

        Logger.info(chalk.blue(`\n   📊 Self-Critique: ${removedCount} false positive(s) removed\n`));

        return filteredFindings;

    } catch (error: any) {
        Logger.warn(chalk.yellow(`   ⚠️ Self-critique failed: ${error.message.slice(0, 100)}`));
        Logger.warn(chalk.yellow("   Keeping all issues as fallback."));
        return findings;
    }
}
