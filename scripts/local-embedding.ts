import { pipeline, env } from "@xenova/transformers";

// Skip local model checks if needed, or let it download
env.allowLocalModels = false;
env.useBrowserCache = false;

export class LocalEmbedding {
    private pipe: any;
    private modelName: string;

    constructor() {
        this.modelName = "Xenova/bge-small-en-v1.5";
    }

    async init() {
        if (!this.pipe) {
            console.log("📥 Loading local embedding model (Xenova/bge-small-en-v1.5)...");
            this.pipe = await pipeline("feature-extraction", this.modelName);
        }
    }

    async getTextEmbedding(text: string): Promise<number[]> {
        await this.init();
        const result = await this.pipe(text, { pooling: "mean", normalize: true });
        return Array.from(result.data);
    }

    async getQueryEmbedding(query: string): Promise<number[]> {
        return this.getTextEmbedding(query);
    }

    // Batch method (Required by LlamaIndex)
    async getTextEmbeddings(texts: string[]): Promise<number[][]> {
        await this.init();
        const embeddings: number[][] = [];
        for (const text of texts) {
            embeddings.push(await this.getTextEmbedding(text));
        }
        return embeddings;
    }

    // Stubs for BaseEmbedding interface compliance
    embedBatchSize = 10;
    similarity(embedding1: number[], embedding2: number[]): number {
        // Simple dot product for normalized vectors
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
