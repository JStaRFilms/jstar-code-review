# J Star Code Reviewer

AI-powered PR review bot that uses the **Two-Stage Pipeline** to save costs while catching critical issues.

## 🧠 Architecture

```
PR Opened
    │
    ▼
┌─────────────────────────────────────────┐
│  STAGE 1: TRIAGE (Llama 17B)            │
│  • Cheap & Fast                         │
│  • Classifies risk & priority           │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  STAGE 2: DOC DRIFT CHECK (New!)        │
│  • "Vibe Check": Did you add a feature  │
│     but forget the docs?                │
│  • Auto-generates fix prompts for docs  │
└─────────────────────────────────────────┘
    │
    ▼ (If needed)
┌─────────────────────────────────────────┐
│  STAGE 3: DEEP REVIEW (Kimi k2)         │
│  • Reads .jstar/rules.md for context    │
│  • Reviews logic with full awareness    │
└─────────────────────────────────────────┘
```

## 🗂️ Project Structure

```
.
├── .github/workflows/jstar-review.yml    # GitHub Action trigger
├── src/
│   ├── orchestrator.ts                   # Main runner (Two-Stage Pipeline)
│   ├── prompts.ts                        # System prompts for triage & review
│   └── types.ts                          # Zod schemas for structured output
├── .env.example                          # Environment variable template
├── package.json
└── tsconfig.json
```

## 🚀 Quick Start

### Option A: Add to Any Repository (Recommended)

See **[docs/SPAWN_GUIDE.md](docs/SPAWN_GUIDE.md)** for a complete guide to spawn J Star in any repo.

**TL;DR:**
1. Copy `.github/workflows/spawn-template.yml` to your repo as `.github/workflows/jstar-review.yml`
2. Add `GROQ_API_KEY` to your repo secrets
3. Done! 🎉

---

### Option B: Clone and Self-Host

#### 1. Clone and Install

```bash
npm install
```

#### 2. Set Secrets in GitHub

Go to your repo → Settings → Secrets and variables → Actions:

| Secret | Description |
|--------|-------------|
| `GROQ_API_KEY` | Your Groq API key from [console.groq.com](https://console.groq.com) |

> `GITHUB_TOKEN` is automatically provided by GitHub Actions.

#### 3. Done!

Open a PR and watch J Star review it.


## 🧪 Local Testing

```bash
# 1. Copy env template
cp .env.example .env.local

# 2. Fill in your values in .env.local

# 3. Run locally
npm run test:local
```

## 🎛️ Configuration

### Using Different Models

Edit `src/orchestrator.ts` to swap providers:

```typescript
// Use Anthropic Claude
import { anthropic } from '@ai-sdk/anthropic';
const model = anthropic('claude-3-5-sonnet-20241022');

// Use local Ollama
import { ollama } from 'ollama-ai-provider';
const model = ollama('llama3.2');

// Use Groq (fast & cheap)
import { groq } from '@ai-sdk/groq';
const model = groq('llama-3.1-70b-versatile');
```

### Customizing Prompts

Edit `src/prompts.ts` to adjust:
- **Tone Matrix** — How formal/casual the bot sounds
- **Focus Areas** — What file types to prioritize
- **Ignore Rules** — What to skip (lockfiles, images, etc.)

## 📊 Output Example

```markdown
## 🔴 J Star Review

**Verdict:** ❌ REQUEST_CHANGES | **Safety Score:** 42/100

---

### 🚨 CRITICAL (1)

#### `src/auth/login.ts` — Line 47 [`SECURITY`]

> Missing rate limiting on login endpoint allows brute force attacks.

<details>
<summary>🤖 AI Fix Prompt</summary>

Implement rate limiting on the /api/auth/login endpoint. Use a sliding window 
of 5 attempts per minute per IP. Return 429 Too Many Requests when exceeded.

</details>
```

## ⚡ Manual Trigger

Comment `/review` on any PR to force a review.

---

Built with ⚡ by J Star Studios
