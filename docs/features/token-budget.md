# Token Budget System

The token budget system prevents "Request too large" crashes when reviewing files with models that have low TPM (Tokens Per Minute) limits.

## How It Works

```
┌─────────────────────────────────────────────────────┐
│              TOTAL_TOKEN_BUDGET = 8000              │
├─────────────────────────────────────────────────────┤
│  Fixed Overhead (measured first)                    │
│  ├── System Prompt:     ~300 tokens                 │
│  ├── Architecture:      ~275 tokens                 │
│  ├── Existing Docs:     ~50 tokens                  │
│  └── Boilerplate:       ~150 tokens                 │
├─────────────────────────────────────────────────────┤
│  Diff Budget = TOTAL - Overhead (min 1000)          │
└─────────────────────────────────────────────────────┘
```

## Location

[reviewFileChunk](file:///c:/CreativeOS/01_Projects/Code/Personal_Stuff/2025-12-12_code_review/src/orchestrator.ts#L431-L476) in `src/orchestrator.ts`

## Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `TOTAL_TOKEN_BUDGET` | 8000 | Safe limit for 10k TPM (leaves 2k for output) |
| `CHARS_PER_TOKEN` | 4 | Rough estimate for tokenization |
| Min diff budget | 1000 | Ensures meaningful review even with large context |

## Debug Output

The system logs the budget split:
```
📊 Token Budget: 775 overhead + 7225 for diff (max 28900 chars)
```

If truncation occurs:
```
✂️ Truncating src/bigfile.ts: 54000 → 28900 chars
```
