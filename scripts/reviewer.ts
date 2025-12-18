import {
    VectorStoreIndex,
    storageContextFromDefaults,
    MetadataMode
} from "llamaindex";
import { Groq } from "groq-sdk";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import simpleGit from "simple-git";
import dotenv from "dotenv";
import { Detective } from "./detective";

dotenv.config();

const STORAGE_DIR = path.join(process.cwd(), ".jstar", "storage");
const SOURCE_DIR = path.join(process.cwd(), "src");
const git = simpleGit();
// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function main() {
    console.log(chalk.blue("🕵️  J-Star Reviewer: Analyzing your changes..."));

    // 0. The Detective (Deterministic Checks)
    console.log(chalk.blue("🔎 Running Detective Engine..."));
    const detective = new Detective(SOURCE_DIR);
    // We only really want to check the CHANGED files ideally, but for now scan all or just continue
    // In a real optimized version we would filter Detective to only check staged files.
    // For now, let's run it on the whole src but only error if we want strictness.
    // Actually, to be fast and relevant, let's just let the user see the output.
    const violations = await detective.scan();
    detective.report();
    if (violations.some(v => v.severity === 'high')) {
        console.log(chalk.red("❌ Detective found simplified HIGH severity issues. Fix them before asking the AI."));
        // Uncomment to block: return; 
        // For now, we proceed to let AI explain them if needed, or just proceed.
    }

    // 1. Get the Diff (What you changed)
    const diff = await git.diff(["--staged"]); // Only looks at files you added
    if (!diff) {
        console.log(chalk.green("No staged changes to review. (Did you 'git add'?)"));
        return;
    }

    // 2. Load the Brain (Your Local Index)
    if (!fs.existsSync(STORAGE_DIR)) {
        console.error(chalk.red("🧠 Brain not found! Run 'npm run index:init' first."));
        return;
    }

    const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });
    // We need to initialize the index from storage
    const index = await VectorStoreIndex.init({ storageContext });

    // 3. The "Smart" Step: Ask the Index for Context
    const retriever = index.asRetriever();
    // Extract simple keywords from the diff (imports, function names)
    // This is a naive regex but works for finding "related" concepts
    const keywords = (diff.match(/import .* from ['"](.*)['"]/g) || [])
        .map(s => s.replace(/import .* from ['"](.*)['"]/, '$1'))
        .concat(diff.match(/function\s+(\w+)/g) || [])
        .join(" ");

    const query = keywords.slice(0, 500) || "general context";
    const contextNodes = await retriever.retrieve({ query });

    const relatedContext = contextNodes.map(n => `NODE: ${n.node.getContent(MetadataMode.NONE)}`).join("\n---\n");

    console.log(chalk.yellow(`🧠 Found ${contextNodes.length} related context chunks.`));

    // 4. Send to Groq (The Judge)
    console.log(chalk.blue("⚖️  Asking the Judge (Groq)..."));

    const systemPrompt = `You are J-Star, a Senior Full-Stack Architect (Next.js, TS, Tailwind).
  Your Vibe: Direct, Objective, No Fluff. "VibeCoding".
  
  TASK: Review the provided Git Diff.
  
  CONTEXT (From Knowledge Graph):
  ${relatedContext}
  
  INSTRUCTIONS:
  1. Analyze the Diff for logic errors, security risks, and architectural violations.
  2. Use the provided CONTEXT to spot breaking changes (e.g. prop mismatches).
  3. If the code is good, say "✅ Vibe Check Passed" and give a 1-sentence summary.
  4. If bad, list specific issues with line numbers.
  `;

    const userMessage = `
  DIFF TO REVIEW:
  ${diff}
  `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            model: "llama3-70b-8192",
            temperature: 0.2,
        });

        console.log("\n" + chalk.bold.white("📝 REVIEW REPORT:") + "\n");
        console.log(completion.choices[0]?.message?.content);

    } catch (error: any) {
        console.error(chalk.red("❌ Groq API Error:"), error.message);
    }
}

main().catch(console.error);
