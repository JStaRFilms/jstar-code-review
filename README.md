# J-Star Code Reviewer

**Local-first, context-aware AI code reviewer** powered by LlamaIndex + Groq.

Works with **any language** — TypeScript, Python, Rust, Go, you name it.

## ✨ Features

- **Local Vector Index** — Embeddings stored locally, no external DB
- **Gemini Embeddings** — Free tier friendly, no OpenAI key needed
- **Chunked Reviews** — Handles large diffs without rate limits
- **Detective Engine** — Deterministic checks for common issues
- **Dashboard Output** — Professional review reports with fix prompts
- **Global CLI** — Install once, use in any project

---

## 🚀 Quick Install

### Option 1: Global CLI (Recommended)

```bash
# Install globally
npm install -g jstar-reviewer

# In any project directory:
jstar setup      # Create config files
jstar init       # Index the codebase
jstar review     # Review staged changes
```

### Option 2: One-Curl (Adds to current project)

```bash
curl -fsSL https://raw.githubusercontent.com/JStaRFilms/jstar-code-review/v2.0.0/setup.js | node
```

### After Install:

1.  **Check Config**: The tool now **auto-creates** `.env.example` and `.jstar/` when you run it.
2.  **Add Keys**: Copy `.env.example` → `.env.local` and add your `GEMINI_API_KEY` and `GROQ_API_KEY`.
3.  **Index**: Run `jstar init` (or `pnpm run index:init`) to build the brain.
4.  **Review**: Stage changes (`git add`) and run `jstar review` (or `pnpm run review`).

For a detailed walkthrough, see **[ONBOARDING.md](./ONBOARDING.md)**.


---

```
git diff --staged
       │
       ▼
┌──────────────────┐
│  Detective       │  ← Static analysis (secrets, console.log, "use client")
│  Engine          │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Local Brain     │  ← Gemini embeddings via LlamaIndex
│  (Retrieval)     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Chunked Review  │  ← Splits diff by file, delays between calls
│  Queue           │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Groq LLM        │  ← moonshotai/kimi-k2-instruct-0905
│  (The Judge)     │
└────────┬─────────┘
         │
         ▼
   📝 Review Report
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Environment Variables

Create `.env.local`:

```env
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
```

### 3. Index Your Codebase

```bash
pnpm run index:init
```

### 4. Review Staged Changes

```bash
git add <files>
pnpm run review
```

## 📁 Project Structure

```
scripts/
├── indexer.ts          # Scans codebase, builds vector index
├── reviewer.ts         # Orchestrates review pipeline
├── detective.ts        # Static analysis engine
├── gemini-embedding.ts # Google Gemini adapter
└── mock-llm.ts         # LlamaIndex compatibility stub

.jstar/
└── storage/            # Persisted embeddings (gitignored)

docs/features/
├── architecture-v2.md  # Full architecture docs
├── detective.md        # Static analysis rules
├── analyst.md          # LLM reviewer (The Judge)
└── ...
```

## ⚙️ Configuration

Edit `scripts/reviewer.ts`:

```typescript
const MODEL_NAME = "moonshotai/kimi-k2-instruct-0905";
const MAX_TOKENS_PER_REQUEST = 8000;
const DELAY_BETWEEN_CHUNKS_MS = 2000;
```

## 📚 Documentation

- [Architecture v2](docs/features/architecture-v2.md)
- [Detective Engine](docs/features/detective.md)
- [Token Budget](docs/features/token-budget.md)
- [Chunked Reviews](docs/features/map-reduce.md)

---

Built with ⚡ by J Star Studios
