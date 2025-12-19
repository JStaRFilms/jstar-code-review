export class MockLLM {
    hasStreaming = false;
    metadata = {
        model: "mock",
        temperature: 0,
        topP: 1,
        contextWindow: 1024,
        tokenizer: undefined,
    };

    async chat(messages: any[], parentEvent?: any): Promise<any> {
        return { message: { content: "Mock response" } };
    }

    async complete(prompt: string, parentEvent?: any): Promise<any> {
        return { text: "Mock response" };
    }
}
