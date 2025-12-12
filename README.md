# J Star Code Reviewer

AI-powered PR review bot that uses the **Two-Stage Pipeline** to save costs while catching critical issues.

## 🧠 Architecture

```
PR Opened
    │
    ▼
┌─────────────────────────────────────────┐
│  STAGE 1: TRIAGE (gpt-4o-mini)          │
│  • Cheap model (~$0.001/PR)             │
│  • Classifies risk level                │
│  • Selects top 5 critical files         │
│  • Skips if LOW risk (CSS, docs, etc.)  │
└─────────────────────────────────────────┘
    │
    ▼ (Only if HIGH/CRITICAL files found)
┌─────────────────────────────────────────┐
│  STAGE 2: DEEP REVIEW (gpt-4o)          │
│  • Powerful model for accuracy          │
│  • Only reviews critical files          │
│  • Structured findings with fix prompts │
│  • Posts markdown comment to PR         │
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

### 1. Clone and Install

```bash
npm install
```

### 2. Set Secrets in GitHub

Go to your repo → Settings → Secrets and variables → Actions:

| Secret | Description |
|--------|-------------|
| `OPENAI_API_KEY` | Your OpenAI API key |

> `GITHUB_TOKEN` is automatically provided by GitHub Actions.

### 3. Done!

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
