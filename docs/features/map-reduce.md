# Map-Reduce Chunking

Scaling solution for reviewing large PRs without hitting token limits.

## Problem
Large diffs (>10k tokens) exceed the LLM's context window or Groq's TPM (Tokens Per Minute) rate limits. Single-shot review fails.

## Solution: Chunked Map-Reduce

### 1. Split (Parse)
The unified diff is parsed into per-file chunks:
```typescript
const fileDiffs = splitDiffByFile(diff);
// Returns: [{ filename: 'auth.ts', diff: '...' }, ...]
```

### 2. Map (Review Each File)
Each file chunk is reviewed independently in parallel batches:
```typescript
const BATCH_SIZE = parseInt(process.env.AI_CONCURRENCY) || 1; // Default 1 (Sequential)
for (let i = 0; i < relevantDiffs.length; i += BATCH_SIZE) {
  const batch = relevantDiffs.slice(i, i + BATCH_SIZE);
  const batchResults = await Promise.all(batch.map(fd => reviewFileChunk(...)));
}
```

Configurable via `AI_CONCURRENCY`. Set to `1` for strict rate limits (default), or `3-5` for higher tiers.

### 3. Reduce (Aggregate)
All chunk results are combined into a final `JStarReviewResult`:
- Findings are merged into a single array.
- Quality scores are averaged across all reviewed files.
- Verdict is determined by worst-case severity.

## Flow Diagram
```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   File A     │      │   File B     │      │   File C     │
│   Diff       │      │   Diff       │      │   Diff       │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │
       ▼                     ▼                     ▼
  ┌─────────┐           ┌─────────┐           ┌─────────┐
  │ Review A│           │ Review B│           │ Review C│
  └────┬────┘           └────┬────┘           └────┬────┘
       │                     │                     │
       └──────────────┬──────┴─────────────────────┘
                      ▼
               ┌────────────┐
               │  Aggregate │
               │  Findings  │
               └────────────┘
```

## Threshold
- **Single-Shot:** Used when estimated tokens ≤ 8000.
- **Chunked:** Used when estimated tokens > 8000.

Token estimation: `Math.ceil(diff.length / 4)` (rough 4 chars per token).

## Error Handling
If a single file review fails, it returns a fallback:
```typescript
return { file: filename, findings: [], quality_score: 0 };
```
This ensures one bad file doesn't crash the entire review.
