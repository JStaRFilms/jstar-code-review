import {
    VectorStoreIndex,
    storageContextFromDefaults,
    SimpleDirectoryReader,
    OpenAIEmbedding,
    Settings
} from "llamaindex";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import dotenv from "dotenv";

dotenv.config();

// Configuration
const STORAGE_DIR = path.join(process.cwd(), ".jstar", "storage");
const SOURCE_DIR = path.join(process.cwd(), "src");

// Ensure OpenAI Key exists (LlamaIndex default) or fallback if we configured something else
if (!process.env.OPENAI_API_KEY) {
    console.warn(chalk.yellow("⚠️  OPENAI_API_KEY not found. Embeddings may fail unless you have configured a local model."));
}

async function main() {
    const args = process.argv.slice(2);
    const isWatch = args.includes("--watch");

    console.log(chalk.blue("🧠 J-Star Indexer: Scanning codebase..."));

    // 1. Load documents (Your Code)
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(chalk.red(`❌ Source directory not found: ${SOURCE_DIR}`));
        process.exit(1);
    }

    const reader = new SimpleDirectoryReader();
    const documents = await reader.loadData({ directoryPath: SOURCE_DIR });

    console.log(chalk.yellow(`📄 Found ${documents.length} files to index.`));

    // 2. Create the Storage Context (Persists to disk)
    const storageContext = await storageContextFromDefaults({
        persistDir: STORAGE_DIR,
    });

    // 3. Generate the Index (The heavy lifting)
    // This calculates embeddings and builds the vector store
    const index = await VectorStoreIndex.fromDocuments(documents, {
        storageContext,
    });

    console.log(chalk.green("✅ Indexing Complete. Brain is updated."));

    if (isWatch) {
        console.log(chalk.blue("👀 Watch mode enabled (This is a placeholder for file watcher logic)"));
        // Real implementation would use chokidar to re-index on change
    }
}

main().catch(console.error);
