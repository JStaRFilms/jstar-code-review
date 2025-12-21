---
description: Spawn J Star Code Review bot into the current repository
---

# /spawn-jstar - Add J Star Reviewer v2 to Any Project

Works with **any programming language** — TypeScript, Python, Rust, Go, etc.

## Prerequisites
- Node.js 18+ installed on your machine

## Steps

### 1. Install the CLI Globally (One Time)
// turbo
```bash
npm install -g jstar-reviewer
```

### 2. Run your First Command
// turbo
```bash
jstar setup
```
*(Or simply run `jstar review` if you already have your keys ready)*

This **auto-creates** (or updates):
- `.jstar/` directory
- `.env.example` with required variables
- `.gitignore` (appends `.jstar/` and `.env.local`)


### 3. Configure Environment Variables
```bash
cp .env.example .env.local
```

Edit `.env.local` and add your API keys:
```env
GOOGLE_API_KEY=your_google_api_key_here
GROQ_API_KEY=your_groq_api_key_here
```

**Where to get keys:**
- Google API Key: [Google AI Studio](https://aistudio.google.com/apikey)
- Groq API Key: [console.groq.com](https://console.groq.com)

### 4. Index Your Codebase (Build the Brain)
```bash
jstar init
```

This scans your codebase and creates embeddings for context-aware reviews.

### 5. (Optional) Create Rules File
Create `.jstar/rules.md` with your project-specific coding guidelines:

```markdown
# Project Coding Rules

## General
- Follow PEP 8 (Python) / Google Style Guide
- Add docstrings to all public functions



## Security  
- Never log sensitive data
- Validate all user inputs
```

### 6. Run Your First Review
Stage some changes and run:
```bash
git add <files>
jstar review
```

The dashboard will be saved to `.jstar/last-review.md`.

## Done! 🎉

**CLI Commands:**
| Command | Description |
|---------|-------------|
| `jstar setup` | Create config files in current project |
| `jstar init` | Index codebase (after major changes) |
| `jstar review` | Review staged changes |

**Output:**
- Console: Quick summary with severity counts
- `.jstar/last-review.md`: Full dashboard with fix prompts

## Alternative: Without Global Install

If you don't want to install globally:
```bash
npx jstar-reviewer review
```