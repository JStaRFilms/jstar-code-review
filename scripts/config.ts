import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { Severity } from "./types";

// --- Auto-Setup Logic ---
const REQUIRED_ENV_VARS = {
    'GOOGLE_API_KEY': '# Required: Google API key for Gemini embeddings\nGOOGLE_API_KEY=your_google_api_key_here',
    'GROQ_API_KEY': '# Required: Groq API key for LLM reviews\nGROQ_API_KEY=your_groq_api_key_here',
    'REVIEW_MODEL_NAME': '# Optional: Override the default model\n# REVIEW_MODEL_NAME=moonshotai/kimi-k2-instruct-0905'
};

function ensureSetup() {
    const cwd = process.cwd();
    const jstarDir = path.join(cwd, ".jstar");
    const envExamplePath = path.join(cwd, ".env.example");

    // 1. Ensure .jstar exists
    if (!fs.existsSync(jstarDir)) {
        fs.mkdirSync(jstarDir, { recursive: true });
    }

    // 2. Ensure .env.example is up to date
    if (fs.existsSync(envExamplePath)) {
        let content = fs.readFileSync(envExamplePath, 'utf-8');
        let missing = false;
        for (const [key, template] of Object.entries(REQUIRED_ENV_VARS)) {
            if (!content.includes(key)) {
                content += `\n${template}\n`;
                missing = true;
            }
        }
        if (missing) {
            fs.writeFileSync(envExamplePath, content);
        }
    } else {
        const initialEnv = "# J-Star Code Reviewer\n" + Object.values(REQUIRED_ENV_VARS).join("\n") + "\n";
        fs.writeFileSync(envExamplePath, initialEnv);
    }
}

// Run setup check
ensureSetup();

// Load .env.local first, then .env - USE ABSOLUTE PATHS based on CWD
// This is critical for global CLI usage where the package is installed elsewhere
const cwd = process.cwd();
dotenv.config({ path: path.join(cwd, ".env.local") });
dotenv.config({ path: path.join(cwd, ".env") });

/**
 * Default fallback values.
 */
const DEFAULT_MODEL = "moonshotai/kimi-k2-instruct-0905";

export const Config = {
    MODEL_NAME: process.env.REVIEW_MODEL_NAME || DEFAULT_MODEL,
    DEFAULT_SEVERITY: 'P2_MEDIUM' as Severity,
    THRESHOLDS: {
        MEDIUM: 5
    }
};

