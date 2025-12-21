import {
    VectorStoreIndex,
    storageContextFromDefaults,
    SimpleDirectoryReader,
    serviceContextFromDefaults
} from "llamaindex";
import { GeminiEmbedding } from "./gemini-embedding";
import { MockLLM } from "./mock-llm";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
// IMPORTANT: Import config for side effects (loads dotenv from cwd)
import "./config";

// Configuration
const STORAGE_DIR = path.join(process.cwd(), ".jstar", "storage");

// Smart source directory detection
function getSourceDir(): string {
    const cwd = process.cwd();

    // 1. Check for --path argument
    const args = process.argv.slice(2);
    const pathArgIndex = args.indexOf('--path');
    if (pathArgIndex !== -1 && args[pathArgIndex + 1]) {
        const customPath = path.resolve(cwd, args[pathArgIndex + 1]);
        if (fs.existsSync(customPath)) {
            return customPath;
        }
        console.error(chalk.red(`❌ Custom path not found: ${customPath}`));
        process.exit(1);
    }

    // 2. Try common source directories
    const candidates = ['src', 'lib', 'app', 'scripts', '.'];
    for (const dir of candidates) {
        const fullPath = path.join(cwd, dir);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            // Skip '.' if there's a more specific match
            if (dir === '.' && candidates.slice(0, -1).some(d => fs.existsSync(path.join(cwd, d)))) {
                continue;
            }
            return fullPath;
        }
    }

    // Default to cwd
    return cwd;
}

async function main() {
    // 0. Environment Validation
    if (!process.env.GOOGLE_API_KEY) {
        console.error(chalk.red("❌ Missing GOOGLE_API_KEY!"));
        console.log(chalk.yellow("\nPlease ensure you have a .env.local file. Check .env.example for a template.\n"));
        process.exit(1);
    }

    const args = process.argv.slice(2);
    const isWatch = args.includes("--watch");
    const SOURCE_DIR = getSourceDir();

    console.log(chalk.blue("🧠 J-Star Indexer: Scanning codebase..."));
    console.log(chalk.dim(`   Source: ${SOURCE_DIR}`));

    // 1. Load documents (Your Code)
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(chalk.red(`❌ Source directory not found: ${SOURCE_DIR}`));
        process.exit(1);
    }

    const reader = new SimpleDirectoryReader();
    const documents = await reader.loadData({ directoryPath: SOURCE_DIR });

    console.log(chalk.yellow(`📄 Found ${documents.length} files to index.`));

    const isInit = args.includes("--init");

    try {
        // 2. Setup Service Context with Google Gemini Embeddings
        // using 'models/text-embedding-004' which is a strong, recent model
        const embedModel = new GeminiEmbedding();
        const llm = new MockLLM();
        const serviceContext = serviceContextFromDefaults({
            embedModel,
            llm: llm as any
        });

        // 3. Create the Storage Context
        let storageContext;
        if (isInit) {
            console.log(chalk.blue("✨ Initializing fresh Local Brain..."));
            storageContext = await storageContextFromDefaults({});
        } else {
            // Try to load
            if (!fs.existsSync(STORAGE_DIR)) {
                console.log(chalk.yellow("⚠️  Storage not found. Running fresh init..."));
                storageContext = await storageContextFromDefaults({});
            } else {
                storageContext = await storageContextFromDefaults({
                    persistDir: STORAGE_DIR,
                });
            }
        }

        // 4. Generate the Index
        const index = await VectorStoreIndex.fromDocuments(documents, {
            storageContext,
            serviceContext,
        });

        // 4. Persist (Save the Brain)
        // Manual persistence for LlamaIndex TS compatibility
        const ctxToPersist: any = index.storageContext;
        if (ctxToPersist.docStore) await ctxToPersist.docStore.persist(path.join(STORAGE_DIR, "doc_store.json"));
        if (ctxToPersist.vectorStore) await ctxToPersist.vectorStore.persist(path.join(STORAGE_DIR, "vector_store.json"));
        if (ctxToPersist.indexStore) await ctxToPersist.indexStore.persist(path.join(STORAGE_DIR, "index_store.json"));
        if (ctxToPersist.propStore) await ctxToPersist.propStore.persist(path.join(STORAGE_DIR, "property_store.json"));

        console.log(chalk.green("✅ Indexing Complete. Brain is updated."));

        if (isWatch) {
            console.log(chalk.blue("👀 Watch mode enabled."));
        }

    } catch (e: any) {
        console.error(chalk.red("❌ Indexing Failed:"), e.message);
        if (e.message.includes("API") || e.message.includes("key")) {
            console.log(chalk.yellow("👉 Tip: Make sure you have GOOGLE_API_KEY in your .env.local file."));
        }
        process.exit(1);
    }
}

main().catch(console.error);
