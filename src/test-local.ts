// src/test-local.ts
// Local Dry Run: Test J Star Reviewer without touching GitHub
// Usage: npm run test:dry

import { generateObject } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { TRIAGE_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT, buildAnalystUserPrompt } from './prompts.js';
import { TriageSchema, JStarReviewSchema, type JStarReviewResult, type Finding } from './types.js';

// Load .env.local
config({ path: '.env.local' });

// Initialize Groq provider
const groq = createGroq({
    apiKey: process.env.GROQ_API_KEY,
});

// Model configuration from env
const TRIAGE_MODEL = process.env.TRIAGE_MODEL || 'llama-3.1-8b-instant';
const ANALYST_MODEL = process.env.ANALYST_MODEL || 'llama-3.3-70b-versatile';

// ============================================================
// MOCK PR DATA (Simulated "Bad Code" for Testing)
// ============================================================

const MOCK_FILES = [
    'src/features/themes/schemas.ts',
    'src/features/themes/actions.ts',
    'src/auth/login.ts',
    'src/api/users/route.ts',
    'src/components/Button.tsx',
    'styles/globals.css',
    'README.md',
];

// Simulated existing docs (to test false positive fix)
const MOCK_EXISTING_DOCS = [
    'docs/features/themes.md',
    'docs/features/auth.md',
];

const MOCK_DIFF = `
diff --git a/src/features/themes/schemas.ts b/src/features/themes/schemas.ts
index 1234567..abcdefg 100644
--- a/src/features/themes/schemas.ts
+++ b/src/features/themes/schemas.ts
@@ -1,5 +1,15 @@
+import { z } from 'zod';
+
+export const ThemeSchema = z.object({
+  name: z.string(),
+  primaryColor: z.string(),
+  secondaryColor: z.string(),
+});
+
+export type Theme = z.infer<typeof ThemeSchema>;

diff --git a/src/auth/login.ts b/src/auth/login.ts
index 1234567..abcdefg 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,10 +1,25 @@
+import { db } from '../lib/database';

 export async function login(req: Request) {
   const { email, password } = await req.json();
   
-  // TODO: Add validation
+  // Query user directly with string interpolation (BAD!)
+  const user = await db.query(\`SELECT * FROM users WHERE email = '\${email}'\`);
   
-  return { success: true };
+  if (!user) {
+    return Response.json({ error: 'User not found' }, { status: 404 });
+  }
+
+  // Plain text password comparison (BAD!)
+  if (user.password !== password) {
+    return Response.json({ error: 'Invalid password' }, { status: 401 });
+  }
+
+  // No rate limiting, no session management
+  return Response.json({ token: user.id });
 }

diff --git a/src/api/users/route.ts b/src/api/users/route.ts
index 7654321..fedcba9 100644
--- a/src/api/users/route.ts
+++ b/src/api/users/route.ts
@@ -5,6 +5,15 @@ export async function GET(req: Request) {
   // Fetch all users
   const users = await db.query('SELECT * FROM users');
   
+  // Exposing all user data including passwords (BAD!)
+  return Response.json(users);
+}
+
+export async function DELETE(req: Request) {
+  const { id } = await req.json();
+  
+  // No authorization check! Anyone can delete users (BAD!)
+  await db.query(\`DELETE FROM users WHERE id = \${id}\`);
   return Response.json({ success: true });
 }

diff --git a/styles/globals.css b/styles/globals.css
index aaaaaaa..bbbbbbb 100644
--- a/styles/globals.css
+++ b/styles/globals.css
@@ -1,3 +1,8 @@
 body {
   font-family: sans-serif;
+  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
+}
+
+.button {
+  border-radius: 8px;
 }
`;

// ============================================================
// FORMAT REVIEW COMMENT (Copy from orchestrator for testing)
// ============================================================

function formatReviewComment(review: JStarReviewResult): string {
    const score = review.summary.risk_score;
    const verdict = review.summary.verdict;

    // 1. Calculate Metrics
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, NITPICK: 0 };
    for (const f of review.findings) {
        counts[f.severity]++;
    }
    const totalFindings = review.findings.length;

    // 2. Determine Mode
    // High-Density Mode if >= 15 findings
    const isHighDensity = totalFindings >= 15;

    // 3. Header (Score + Summary Table)
    const icon = score > 80 ? '🟢' : score > 50 ? '🟡' : '🔴';
    let md = `# ${icon} J Star Code Audit\n\n`;

    // Simple metrics table (Canonical Rule 2)
    md += `| Score | Verdict | 🚨 Critical | 🔶 High | 🔹 Medium | 🔧 Nitpick |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    md += `| **${score}/100** | **${verdict}** | ${counts.CRITICAL || '-'} | ${counts.HIGH || '-'} | ${counts.MEDIUM || '-'} | ${counts.NITPICK || '-'} |\n\n`;

    if (totalFindings === 0) {
        md += `### ✨ No issues found. Ship it!\n\n---\n\n`;
        md += `Powered by J Star Sentinel ⚡`;
        return md;
    }

    // Group findings by file
    const byFile = new Map<string, Finding[]>();
    for (const f of review.findings) {
        if (!byFile.has(f.file)) byFile.set(f.file, []);
        byFile.get(f.file)!.push(f);
    }

    // Icons mapping
    const sevIcons: Record<string, string> = { CRITICAL: '🚨', HIGH: '🔶', MEDIUM: '🔹', NITPICK: '🔧' };

    // 4. Render Body based on Mode
    if (isHighDensity) {
        md += `**SUMMARY MODE** (High finding count detected)\n\n`;

        for (const [file, findings] of byFile) {
            md += `### 📄 ${file}\n\n`;
            md += `| Sev | Cat | Issue | Fix |\n`;
            md += `| :--- | :--- | :--- | :--- |\n`;

            for (const f of findings) {
                const title = f.title || f.message.substring(0, 50); // Fallback if title missing during migration
                const desc = f.message;
                const fix = f.fix_prompt ? `\`${f.fix_prompt.substring(0, 50)}${f.fix_prompt.length > 50 ? '...' : ''}\`` : 'See comments';
                md += `| ${sevIcons[f.severity]} | ${f.category} | **${title}**<br>${desc} | ${fix} |\n`;
            }
            md += `\n`;
        }

    } else {
        // Default Mode (Standard PR Review)
        for (const [file, findings] of byFile) {
            md += `## 📄 ${file}\n\n`;

            const fixes: string[] = [];

            for (const f of findings) {
                const title = f.title || 'Untitled Issue';
                const isAlertAndCritical = f.severity === 'CRITICAL';
                const isAlertAndHigh = f.severity === 'HIGH';

                // Collect fix if available
                if (f.fix_prompt) {
                    fixes.push(`**${title}**: ${f.fix_prompt}`);
                }

                // Rule 3: GitHub Alerts for CRITICAL/HIGH
                if (isAlertAndCritical || isAlertAndHigh) {
                    const alertType = isAlertAndCritical ? 'CAUTION' : 'WARNING';

                    md += `> [!${alertType}]\n`;
                    md += `> **${title}**\n`;
                    md += `> ${f.message}\n`;
                    md += `\n`; // End blockquote
                } else {
                    // Standard Rendering for Medium/Nitpick
                    md += `### ${sevIcons[f.severity]} ${title}\n`;
                    md += `**Category:** ${f.category}\n\n`;
                    md += `${f.message}\n\n`;
                }
            }

            // Render Grouped Fixes
            if (fixes.length > 0) {
                md += `**🛠️ Recommended Fixes**\n\n`;
                for (const fix of fixes) {
                    md += `- ${fix}\n`;
                }
            }

            md += `\n---\n\n`;
        }
    }

    // 5. Footer (Canonical Rule 7)
    md += `Powered by J Star Sentinel ⚡`;
    return md;
}

// ============================================================
// DRY RUN PIPELINE
// ============================================================

async function runDryTest() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🧪 J STAR DRY RUN - Local Test Mode (Groq)');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Validate API key
    if (!process.env.GROQ_API_KEY) {
        console.error('❌ Missing GROQ_API_KEY in .env.local');
        console.log('\n📝 Get your key from: https://console.groq.com/keys\n');
        process.exit(1);
    }

    console.log(`🔧 Config:`);
    console.log(`   Triage Model:  ${TRIAGE_MODEL}`);
    console.log(`   Analyst Model: ${ANALYST_MODEL}\n`);

    console.log('📁 Mock PR Files:');
    MOCK_FILES.forEach((f) => console.log(`   - ${f}`));
    console.log(`\n📚 Mock Existing Docs (should NOT be flagged):`);
    MOCK_EXISTING_DOCS.forEach((f) => console.log(`   - ${f}`));
    console.log(`\n📄 Mock Diff Length: ${MOCK_DIFF.length} chars\n`);

    // ──────────────────────────────────────────────────────────
    // STAGE 1: TRIAGE
    // ──────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────');
    console.log(`  STAGE 1: TRIAGE (${TRIAGE_MODEL})`);
    console.log('─────────────────────────────────────────────────────────\n');

    const triageStart = Date.now();
    const { object: triage } = await generateObject({
        model: groq(TRIAGE_MODEL),
        schema: TriageSchema,
        system: TRIAGE_SYSTEM_PROMPT,
        prompt: `
PR contains ${MOCK_FILES.length} files. Diff length: ${MOCK_DIFF.length} characters.

Files changed:
${MOCK_FILES.map((f) => `- ${f}`).join('\n')}

Classify this PR and identify critical files to audit.
`,
    });
    const triageTime = Date.now() - triageStart;

    console.log('📊 Triage Result:');
    console.log(`   Risk Level: ${triage.risk_level}`);
    console.log(`   Files to Audit: ${JSON.stringify(triage.files_to_audit)}`);
    console.log(`   Ignore Reason: ${triage.ignore_reason || 'N/A'}`);
    console.log(`   ⏱️  Time: ${triageTime}ms\n`);

    if (triage.files_to_audit.length === 0) {
        console.log('✅ Triage says: LOW RISK - No deep review needed!\n');
        return;
    }

    // ──────────────────────────────────────────────────────────
    // STAGE 2: DEEP REVIEW
    // ──────────────────────────────────────────────────────────
    console.log('─────────────────────────────────────────────────────────');
    console.log(`  STAGE 2: DEEP REVIEW (${ANALYST_MODEL})`);
    console.log('─────────────────────────────────────────────────────────\n');

    const reviewStart = Date.now();
    const { object: review } = await generateObject({
        model: groq(ANALYST_MODEL),
        schema: JStarReviewSchema,
        system: ANALYST_SYSTEM_PROMPT,
        prompt: buildAnalystUserPrompt(triage.files_to_audit, MOCK_FILES, MOCK_DIFF, MOCK_EXISTING_DOCS),
    });
    const reviewTime = Date.now() - reviewStart;

    console.log('🔬 Review Summary:');
    console.log(`   Risk Score: ${review.summary.risk_score}/100`);
    console.log(`   Verdict: ${review.summary.verdict}`);
    console.log(`   Tone: ${review.summary.tone}`);
    console.log(`   ⏱️  Time: ${reviewTime}ms\n`);

    console.log('📋 Findings:');
    if (review.findings.length === 0) {
        console.log('   ✨ No issues found!\n');
    } else {
        review.findings.forEach((f) => {
            const icon = f.severity === 'CRITICAL' ? '🚨' : f.severity === 'HIGH' ? '⚠️' : '📝';
            console.log(`\n   ${icon} [${f.severity}] ${f.file}:${f.line}`);
            console.log(`      Title: ${f.title}`);
            console.log(`      Category: ${f.category}`);
            console.log(`      Message: ${f.message}`);
            if (f.fix_prompt) {
                console.log(`      Fix Prompt: "${f.fix_prompt.substring(0, 60)}..."`);
            } else {
                console.log(`      ⚠️ Fix Prompt: MISSING!`);
            }
        });
    }

    // ──────────────────────────────────────────────────────────
    // CHECK FOR FALSE POSITIVES
    // ──────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────────────');
    console.log('  🔍 FALSE POSITIVE CHECK');
    console.log('─────────────────────────────────────────────────────────\n');

    const docFindings = review.findings.filter(f => f.category === 'DOCUMENTATION');
    const themesDocFindings = docFindings.filter(f => f.file.includes('themes'));

    if (themesDocFindings.length > 0) {
        console.log('   ❌ FALSE POSITIVE DETECTED!');
        console.log('   Bot flagged themes/* as missing docs, but themes.md exists in MOCK_EXISTING_DOCS');
        themesDocFindings.forEach(f => {
            console.log(`      - ${f.file}: ${f.message}`);
        });
    } else {
        console.log('   ✅ No false positives for themes/ (correctly recognized themes.md exists)');
    }

    // ──────────────────────────────────────────────────────────
    // RENDER FORMATTED OUTPUT
    // ──────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────────────');
    console.log('  📝 FORMATTED OUTPUT (GitHub Markdown)');
    console.log('─────────────────────────────────────────────────────────\n');

    const formattedOutput = formatReviewComment(review);
    console.log(formattedOutput);

    // Save to file for easy viewing
    const outputPath = path.join(process.cwd(), 'dry-run-output.md');
    fs.writeFileSync(outputPath, formattedOutput);
    console.log(`\n📁 Output saved to: ${outputPath}`);

    // ──────────────────────────────────────────────────────────
    // SUMMARY
    // ──────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  📈 DRY RUN COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Total Time: ${triageTime + reviewTime}ms`);
    console.log(`  Findings: ${review.findings.length}`);
    console.log(`  Verdict: ${review.summary.verdict}`);
    console.log('═══════════════════════════════════════════════════════════\n');
}

runDryTest().catch((error) => {
    console.error('\n❌ Dry Run Failed:', error.message);
    if (error.cause) {
        console.error('   Cause:', error.cause);
    }
    process.exit(1);
});
