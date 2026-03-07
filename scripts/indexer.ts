import {
    VectorStoreIndex,
    storageContextFromDefaults,
    SimpleDirectoryReader,
    serviceContextFromDefaults,
} from "llamaindex";
import { GeminiEmbedding } from "./gemini-embedding";
import { MockLLM } from "./mock-llm";
import * as path from "path";
import * as fs from "fs";
import chalk from "chalk";
import { Logger } from "./utils/logger";
import { getSourceDir, shouldExcludeFromIndexing } from "./core/project";
import "./config";

const STORAGE_DIR = path.join(process.cwd(), ".jstar", "storage");

async function main() {
    Logger.init();

    const geminiKey =
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!geminiKey) {
        Logger.error("❌ Missing GEMINI_API_KEY (or GOOGLE_API_KEY)!");
        Logger.warn("\nPlease ensure you have a .env.local file. Check .env.example for a template.\n");
        process.exit(1);
    }

    const args = process.argv.slice(2);
    const isWatch = args.includes("--watch");
    const sourceDir = getSourceDir(process.cwd(), args);

    Logger.info(chalk.blue("🧠 J-Star Indexer: Scanning codebase..."));
    Logger.dim(`   Source: ${sourceDir}`);

    if (!fs.existsSync(sourceDir)) {
        Logger.error(`❌ Source directory not found: ${sourceDir}`);
        process.exit(1);
    }

    const reader = new SimpleDirectoryReader();
    const documents = await reader.loadData({ directoryPath: sourceDir });
    const filteredDocuments = documents.filter((doc) => {
        const filePath = (doc.metadata as any)?.file_path || (doc as any).id_ || "";
        return !shouldExcludeFromIndexing(filePath);
    });

    Logger.info(
        chalk.yellow(
            `📄 Found ${documents.length} files. Indexing ${filteredDocuments.length} valid files (filtered ${documents.length - filteredDocuments.length} excluded).`,
        ),
    );

    const isInit = args.includes("--init");

    try {
        const embedModel = new GeminiEmbedding();
        const llm = new MockLLM();
        const serviceContext = serviceContextFromDefaults({
            embedModel,
            llm: llm as any,
        });

        let storageContext;
        if (isInit) {
            Logger.info(chalk.blue("✨ Initializing fresh Local Brain..."));
            storageContext = await storageContextFromDefaults({});
        } else if (!fs.existsSync(STORAGE_DIR)) {
            Logger.warn("⚠️  Storage not found. Running fresh init...");
            storageContext = await storageContextFromDefaults({});
        } else {
            storageContext = await storageContextFromDefaults({
                persistDir: STORAGE_DIR,
            });
        }

        const index = await VectorStoreIndex.fromDocuments(filteredDocuments, {
            storageContext,
            serviceContext,
        });

        const ctxToPersist: any = index.storageContext;
        if (ctxToPersist.docStore) {
            await ctxToPersist.docStore.persist(path.join(STORAGE_DIR, "doc_store.json"));
        }
        if (ctxToPersist.vectorStore) {
            await ctxToPersist.vectorStore.persist(path.join(STORAGE_DIR, "vector_store.json"));
        }
        if (ctxToPersist.indexStore) {
            await ctxToPersist.indexStore.persist(path.join(STORAGE_DIR, "index_store.json"));
        }
        if (ctxToPersist.propStore) {
            await ctxToPersist.propStore.persist(path.join(STORAGE_DIR, "property_store.json"));
        }

        Logger.success("✅ Indexing complete. Brain is updated.");

        if (isWatch) {
            Logger.info(chalk.blue("👀 Watch mode enabled."));
        }
    } catch (error: any) {
        Logger.error(`❌ Indexing failed: ${error.message}`);
        if (error.message.includes("Embedding model")) {
            Logger.warn('👉 Tip: use `GEMINI_EMBEDDING_MODEL=gemini-embedding-001` unless you have a newer confirmed Google embedding model.');
        } else if (error.message.includes("API") || error.message.includes("key")) {
            Logger.warn("👉 Tip: Make sure you have GEMINI_API_KEY in your .env.local file.");
        }
        process.exit(1);
    }
}

main().catch((error: Error) => Logger.error(error.message));
