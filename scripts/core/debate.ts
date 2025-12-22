import { VectorStoreIndex, MetadataMode } from "llamaindex";
import { generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { Config } from "../config";
import chalk from "chalk";

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

export interface DebateResult {
    text: string;
    severity: 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'LGTM' | 'UNCHANGED';
}

export async function debateIssue(
    issueTitle: string,
    issueDescription: string,
    fileName: string,
    userArgument: string,
    index: VectorStoreIndex
): Promise<DebateResult> {

    // Validate API key before making any calls
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is required for debate mode. Please set it in your .env.local file.");
    }

    console.log(chalk.dim("   🧠  Thinking... (Consulting the Brain)"));

    // 1. Extract keywords/context
    const query = `${userArgument} ${issueTitle}`;

    // 2. Retrieve new context
    const retriever = index.asRetriever({ similarityTopK: 2 });
    const contextNodes = await retriever.retrieve(query);
    const newContext = contextNodes.map(n => n.node.getContent(MetadataMode.NONE)).join("\n\n").slice(0, 2000);

    if (newContext.length >= 2000) {
        console.log(chalk.yellow("   ⚠️  Context truncated to 2000 chars"));
    }

    const sources = contextNodes.map(n => n.node.metadata?.['file_name']).filter(Boolean).join(', ');
    if (sources) {
        console.log(chalk.dim(`   🔍  Found relevant context from: ${sources}`));
    }

    // 3. Ask the Judge
    const systemPrompt = `You are a Senior Code Reviewer in a debate with a developer.
    
    ORIGINAL FINDING: "${issueTitle} - ${issueDescription}" in file ${fileName}.
    USER DEFENSE: "${userArgument}"
    
    NEW CONTEXT FOUND IN REPO:
    ${newContext}
    
    TASK:
    Analyze the USER INPUT.
    
    1. **IS IT A QUESTION?** (e.g., "What does this mean?", "Why is this wrong?")
       - If yes, **EXPLAIN** the technical reasoning behind the finding. 
       - Reference the specific code/context.
       - Do NOT withdraw the issue (Severity: UNCHANGED).
       - Tone: Educational and helpful.

    2. **IS IT A DEFENSE/ARGUMENT?** (e.g., "This is handled in utils.ts", "It's a false positive because...")
       - Evaluate if the user is correct based on the NEW CONTEXT.
       - If user is RIGHT: Apologize and withdraw (Severity: LGTM).
       - If user is WRONG: Explain why, citing the context. (Severity: UNCHANGED).
    
    RETURN JSON:
    {
      "response": "Conversational response (explanation or verdict).",
      "severity": "P0_CRITICAL" | "P1_HIGH" | "P2_MEDIUM" | "LGTM" | "UNCHANGED"
    }
    `;

    try {
        const { text } = await generateText({
            model: groq(Config.MODEL_NAME),
            system: systemPrompt,
            prompt: "What is your verdict?",
            temperature: 0.2,
        });

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                // Validate expected structure
                if (parsed && typeof parsed.response === 'string' && parsed.severity) {
                    return {
                        text: parsed.response,
                        severity: parsed.severity
                    };
                }
            } catch (parseError) {
                // JSON parse failed, fall through to default response
            }
        }

        return {
            text: text,
            severity: 'UNCHANGED'
        };

    } catch (error: any) {
        return {
            text: `Failed to debate: ${error.message}`,
            severity: 'UNCHANGED'
        };
    }
}
