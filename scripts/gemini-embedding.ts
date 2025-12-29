import { GoogleGenerativeAI } from "@google/generative-ai";
import { Logger } from "./utils/logger";

export class GeminiEmbedding {
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is missing from environment variables.");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        // User requested 'text-embedding-004', which has better rate limits
        this.model = this.genAI.getGenerativeModel({ model: "text-embedding-004" });
    }

    async getTextEmbedding(text: string): Promise<number[]> {
        // Retry logic for transient network errors
        let retries = 0;
        const maxRetries = 3;
        while (retries < maxRetries) {
            try {
                const result = await this.model.embedContent(text);
                return result.embedding.values;
            } catch (e: any) {
                if (e.message.includes("fetch failed") || e.message.includes("network")) {
                    retries++;
                    const waitTime = Math.pow(2, retries) * 1000;
                    Logger.warn(`⚠️ Network error. Retrying in ${waitTime / 1000}s... (${retries}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    throw e;
                }
            }
        }
        throw new Error("Max retries exceeded for embedding request.");
    }

    async getQueryEmbedding(query: string): Promise<number[]> {
        return this.getTextEmbedding(query);
    }

    async getTextEmbeddings(texts: string[]): Promise<number[][]> {
        const embeddings: number[][] = [];
        Logger.info(`Creating embeddings for ${texts.length} chunks (Batching to avoid rate limits)...`);

        // Process in smaller batches with delay
        const BATCH_SIZE = 1; // Strict serial for safety on free tier
        const DELAY_MS = 1000; // 1s delay between calls

        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            for (const text of batch) {
                let retries = 0;
                let success = false;
                while (!success && retries < 5) {
                    try {
                        const embedding = await this.getTextEmbedding(text);
                        embeddings.push(embedding);
                        success = true;
                        // Standard delay between calls
                        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                        Logger.inline("."); // Progress indicator
                    } catch (e: any) {
                        if (e.message.includes("429") || e.message.includes("quota")) {
                            retries++;
                            const waitTime = Math.pow(2, retries) * 2000; // 2s, 4s, 8s, 16s...
                            Logger.warn(`\n⚠️  Rate limit hit. Retrying in ${waitTime / 1000}s...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                        } else {
                            Logger.error("\n❌ Embedding failed irreversibly: " + e.message);
                            throw e;
                        }
                    }
                }
                if (!success) {
                    throw new Error("Max retries exceeded for rate limits.");
                }
            }
        }
        Logger.success("\n✅ Done embedding.");
        return embeddings;
    }

    // Stubs for BaseEmbedding compliance
    embedBatchSize = 10;
    similarity(embedding1: number[], embedding2: number[]): number {
        return embedding1.reduce((sum, val, i) => sum + val * embedding2[i], 0);
    }
    async transform(nodes: any[], _options?: any): Promise<any[]> {
        for (const node of nodes) {
            node.embedding = await this.getTextEmbedding(node.getContent("text"));
        }
        return nodes;
    }
    async getTextEmbeddingsBatch(texts: string[]): Promise<number[][]> { return this.getTextEmbeddings(texts); }
}
