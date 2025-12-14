# J Star Reviewer - Project History & Changelog

A narrative changelog documenting the evolution of the J Star Code Review bot, explaining the *why* behind major architectural decisions and bug fixes.

---

## Phase 1: Genesis - The Lean Bot
**Commits:** `ad15a57` → `69367a4`
**Date:** Dec 12, 2024

### What Happened
The initial version of J Star was built as a "Lean AI Reviewer" focused on:
1. **Two-Stage Pipeline:** A cheap Triage model to filter files, followed by an expensive Analyst model for deep review.
2. **Strict JSON Output:** Enforced via Zod schemas to prevent AI rambling.
3. **Visual Style:** Added emoji icons, tables, and GitHub alerts for readability.

### Key Decisions
- **Why Two Stages?** Running a powerful LLM on every file in a PR is expensive and slow. Triage uses a tiny model to identify only the critical files (auth, API, database), saving 80%+ cost on routine PRs.
- **Eyes Reaction:** The bot now reacts with 👀 on the triggering comment so the user knows it's working.

---

## Phase 2: Context & Doc Drift
**Commits:** `ca85d5f` → `4d9b55a`
**Date:** Dec 12, 2024

### What Happened
Added the ability for the bot to understand project-specific context:
1. **`.jstar/architecture.md`:** Users can describe their project structure, and the bot will reference it during reviews.
2. **`.jstar/rules.md`:** Project-specific coding standards.
3. **Doc Drift Detection:** The bot checks if new feature code has corresponding documentation.

### Key Decisions
- **Manual → AI-Driven:** Originally, doc drift was checked via regex patterns. This was brittle. Refactored to let the AI reason about whether a feature is documented, using the `docs/features/` inventory as context.
- **Per-Feature Documentation:** The bot now understands that `themes.md` covers ALL files in `src/features/themes/`, not just one file. This prevents false positives like "schemas.ts is missing docs" when `themes.md` already exists.

---

## Phase 3: Scaling Architecture (Map-Reduce)
**Commits:** `4417afa`
**Date:** Dec 12, 2024

### What Happened
Implemented **Chunked Map-Reduce** to handle massive PRs without hitting LLM token limits.

### The Problem
Large diffs (>10k tokens) would exceed the model's context window or TPM (Tokens Per Minute) rate limits.

### The Solution
1. **Split:** Parse the unified diff into per-file chunks.
2. **Map:** Review each file chunk in parallel (batches of 3 to respect RPM limits).
3. **Reduce:** Aggregate all findings and calculate an average quality score.

```
┌──────────────┐      ┌──────────────┐
│   File A     │      │   File B     │
│   Diff       │      │   Diff       │
└──────┬───────┘      └──────┬───────┘
       │                     │
       ▼                     ▼
  ┌─────────┐           ┌─────────┐
  │ Review A│           │ Review B│
  └────┬────┘           └────┬────┘
       │                     │
       └──────────┬──────────┘
                  ▼
           ┌────────────┐
           │  Aggregate │
           │  Findings  │
           └────────────┘
```

---

## Phase 4: Remote Intelligence
**Commits:** `70b4a64`
**Date:** Dec 13, 2024

### What Happened
Switched context loading from local filesystem reads to **GitHub API calls**.

### Why?
The bot runs in a GitHub Actions runner, which clones the repo fresh every time. However, context files (`.jstar/rules.md`, `docs/features/*.md`) might not be present in the shallow clone. Using `Octokit.getContent()` ensures the bot can always fetch the latest context directly from the remote repository, regardless of the runner's local state.

---

## Phase 5: Scoring Logic Stabilization
**Commits:** `163befd` → `31bcb99`
**Date:** Dec 13, 2024

### The Inversion Bug 🐛
**Symptom:** Users reported that fixing code caused their score to *drop*.

**Root Cause:** The variable was named `risk_score`, implying "Higher = More Dangerous". But the definition said `100 = Safe`. This confused the LLM:
- AI sees clean code → Outputs `risk_score: 0` (thinking "0 risk").
- System interprets 0 as "0 Quality" → Score tanks.

**Fix:** Renamed everything to `quality_score` where `100 = Perfect`.

### The Weighted Fix ⚖️
**Symptom:** When users fixed simple files, Triage stopped selecting them for audit. The remaining files were the "bad" ones, causing the average score to drop.

**Root Cause:** The score was only averaging audited files. Skipped files (deemed safe by Triage) contributed nothing to the score.

**Fix:** Implemented **Weighted Partial Scoring**. Skipped files are assumed to have a quality score of 100.

```typescript
FinalScore = ((AuditedScore * AuditedCount) + (100 * SkippedCount)) / TotalCount
```

**Example:**
- 10 files in PR. Triage selects 2 (bad). Deep Review scores them 50.
- Weighted: `((50 * 2) + (100 * 8)) / 10 = 90/100` ✅

---

## Commit Reference Table

| Commit | Summary |
| :--- | :--- |
| `ad15a57` | Initial J Star Reviewer implementation |
| `03da2a4` | Add 👀 reaction on startup |
| `11ec5c7` | Upgrade review visual style (tables, emojis) |
| `69367a4` | Enforce strict JSON schema in prompts |
| `ca85d5f` | Add doc drift detection and architecture context |
| `2bb526b` | Make doc drift configurable via `.jstar/config.json` |
| `b3c9450` | Refactor to AI-driven doc drift detection |
| `4d9b55a` | Deploy lean J Star with explicit doc drift policing |
| `a3d4eb7` | Add reusable workflow system for spawning bot |
| `cf936ec` | Update triage model and add doc drift check stage |
| `4417afa` | Implement chunked map-reduce for large diffs |
| `b948b39` | Enhance audit with per-feature documentation checks |
| `d50087b` | Group recommended fixes in review comments |
| `d31d6ab` | Update audit prompts and high-density threshold |
| `70b4a64` | Switch context loading to remote GitHub API |
| `163befd` | Rename `risk_score` → `quality_score` |
| `31bcb99` | Add weighted score adjustment for skipped files |

---

*Last Updated: December 14, 2024*

---

## Phase 6: Personality & Precision
**Date:** Dec 14, 2024

### What Happened
1.  **Intelligent Deletion Handling:** The bot now understands `[removed]` files. It stops flagging "unused variables" in code you just deleted (hallucination fix), but will still catch *dangerous* deletions (like removing security checks).
2.  **Emoji Reactions:** The bot is more expressive.
    - `👀`: "I'm looking at it." (Review Start)
    - `🚀`: "Looks good!" (Pass)
    - `😕`: "I have questions/requests." (Request Changes)

### Key Decisions
- **Fallback Logic:** Automated triggers don't have a comment to react to. Added logic to fall back to reacting to the **PR description** itself, ensuring visual feedback regardless of trigger method.

## Phase 7: Robustness & Self-Hosting
**Date:** Dec 14, 2024

### What Happened
Fixed critical runtime safety issues identified by the bot's own self-audit:
1.  **Unsafe Casting:** `fetchPRDiff` now validates API responses before using them.
2.  **Error Handling:** Reaction failures are logged properly instead of swallowed.
3.  **Duplicate Runs:** Identified and fixed an issue where `spawn-template.yml` could trigger duplicate workflows if misplaced in the `workflows/` directory.

---

## Commit Reference Table Update
| Commit | Summary |
| :--- | :--- |
| `[latest]` | Fix deleted file logic and add emoji reactions |
| `[latest]` | Fix duplicate workflow triggers |
| `[latest]` | Harden runtime safety (orchestrator.ts) |

---

## Phase 8: Stability under Pressure
**Date:** Dec 14, 2024

### What Happened
Stabilized the bot against **Rate Limit Exceeded** crashes when using lower-tier API keys (e.g., Kimi 10k TPM).

### Key Decisions
1.  **Configurable Concurrency:** Added `AI_CONCURRENCY` (default: 1) to allow users to throttle the bot down to sequential processing or scale it up.
2.  **Smart Delay:** Introduced an artificial delay between file chunks, but *only* when running in sequential mode. This prioritizes stability for free-tier users while unblocking speed for pro users.
3.  **Recursion Rewrite:** Fixed a critical bug where the retry logic wasn't awaiting its own recursive calls.
4.  **Conservative Limits:** Reduced the single-shot token limit from 8000 to 6000 to provide a safer buffer against hard API bursts.

---

## Phase 9: Dynamic Token Budget
**Date:** Dec 14, 2024

### The Problem
Despite implementing chunked map-reduce and truncation, the bot still crashed with "Request too large" (14k tokens requested, 10k limit).

**Root Cause:** Static `MAX_CHUNK_SIZE = 30000` chars (~7.5k tokens) didn't account for:
- System prompt overhead (~300 tokens)
- Architecture context (~275 tokens)  
- Existing docs list (~50 tokens)
- Required output buffer (~2000 tokens)

Total: 8k input + 2k output = **10k+ TPM** 🚨

### The Solution
Replaced static truncation with **dynamic token budget calculation**:

```typescript
// 1. Measure overhead first
const fixedOverhead = systemPromptTokens + contextTokens + docsTokens + boilerplateTokens;

// 2. Allocate remaining budget to diff
const diffBudgetTokens = Math.max(TOTAL_TOKEN_BUDGET - fixedOverhead, 1000);
const maxDiffChars = diffBudgetTokens * CHARS_PER_TOKEN;

// 3. Truncate diff to fit
if (fileDiff.length > maxDiffChars) {
    safeDiff = fileDiff.substring(0, maxDiffChars) + '\n... [Truncated]';
}
```

### Key Benefits
- **Adaptive:** Small context → more room for diff. Large context → auto-shrinks diff budget.
- **Safe:** Minimum 1000 tokens for diff ensures meaningful review.
- **Observable:** Logs token budget split for debugging.

---

*Last Updated: December 14, 2024*

