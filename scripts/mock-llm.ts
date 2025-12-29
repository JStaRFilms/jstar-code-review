export class MockLLM {
    hasStreaming = false;
    metadata = {
        model: "mock",
        temperature: 0,
        topP: 1,
        contextWindow: 1024,
        tokenizer: undefined,
    };

    async chat(messages: { content: string, role: string }[], parentEvent?: any): Promise<{ message: { content: string } }> {
        return { message: { content: "Mock response" } };
    }

    async complete(prompt: string, parentEvent?: any): Promise<{ text: string }> {
        return { text: "Mock response" };
    }
}
