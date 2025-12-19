# Chunked Review System

> **Version:** v2  
> **Last Updated:** 2025-12-18

## Problem

Large diffs (>10k tokens) exceed Groq's TPM limits. Single-shot review fails with:

```
❌ Request too large for model: Limit 10000, Requested 17489
```

## Solution: Chunked Serial Processing

### 1. Split (Chunk by File)

```typescript
function chunkDiffByFile(diff: string): string[] {
    return diff.split(/(?=diff --git)/g).filter(Boolean);
}
```

### 2. Filter (Skip Excluded Files)

```typescript
const EXCLUDED_PATTERNS = [
    /pnpm-lock\.yaml/,
    /\.env/,
    /\.json$/,
    /\.md$/,
    /\.jstar\//,
];
```

### 3. Estimate (Check Token Budget)

```typescript
const chunkTokens = estimateTokens(chunk) + estimateTokens(systemPrompt);
if (chunkTokens > MAX_TOKENS_PER_REQUEST) {
    console.log(`⚠️ Skipping ${fileName} (too large)`);
    continue;
}
```

### 4. Review (Serial with Delay)

```typescript
for (const chunk of fileChunks) {
    const { text } = await generateText({ model, prompt });
    reviews.push(text);
    await sleep(DELAY_BETWEEN_CHUNKS_MS); // 2s delay
}
```

### 5. Aggregate (Combine Reports)

```typescript
console.log(reviews.join("\n\n---\n\n"));
```

## Flow Diagram

```
┌──────────────┐
│  Git Diff    │
│  (--staged)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   File A     │     │   File B     │     │   File C     │
│   Chunk      │     │   Chunk      │     │   (Skipped)  │
└──────┬───────┘     └──────┬───────┘     └──────────────┘
       │                    │
       ▼ (2s delay)         ▼ (2s delay)
  ┌─────────┐          ┌─────────┐
  │ Review A│          │ Review B│
  └────┬────┘          └────┬────┘
       │                    │
       └────────┬───────────┘
                ▼
         ┌────────────┐
         │  Final     │
         │  Report    │
         └────────────┘
```

## Error Handling

If a chunk review fails (rate limit, network error):

```typescript
reviews.push(`### ${fileName}\n❌ Review failed: Rate limit hit.`);
```

The review continues to the next chunk instead of crashing.
