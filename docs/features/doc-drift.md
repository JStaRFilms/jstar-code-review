# Doc Drift Detection

Ensures new features have corresponding documentation.

## Purpose
Catch when developers add new feature code without updating docs. Prevents technical debt from accumulating.

## How It Works

### 1. Inventory Loading
The bot fetches all markdown files from `docs/features/` via GitHub API:
```typescript
const docsInventory = await loadDocsInventory(ctx);
// Returns: Map<'themes', 'docs/features/themes.md'>
```

### 2. Per-Feature Mapping
> [!IMPORTANT]
> Documentation is tracked **per-feature**, not per-file!

A feature folder like `src/features/themes/` is covered by `docs/features/themes.md`.
- If `themes.md` exists, ALL files in `themes/` are considered documented.
- `themes/schemas.ts`, `themes/actions.ts`, `themes/components/` → All covered.

### 3. AI Reasoning
The existing docs inventory is passed to the Analyst prompt:
```
=== EXISTING DOCS (DO NOT FLAG THESE FEATURES) ===
docs/features/themes.md
docs/features/auth.md
===
```

The AI only flags missing docs if a **genuinely new** feature folder has **no** corresponding doc file.

## Why AI-Driven?
- **Original Approach:** Regex pattern matching to detect missing docs.
- **Problem:** Brittle. Required constant updating of patterns.
- **Solution:** Let the AI reason about whether documentation exists, using the inventory as context.

## Common False Positive Prevention
If you see the bot flagging files like `themes/schemas.ts` as "missing docs" when `themes.md` exists:
1. Check that `docs/features/themes.md` is committed to the repo.
2. Ensure the bot has access to fetch it via GitHub API.
