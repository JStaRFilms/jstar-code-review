# 🚀 J-Star Reviewer: Quick Start Guide

If you are running this in a new repo for the first time, here is the exact order of events.

## 1. Installation
```bash
pnpm install
```

## 2. Configuration (The "Zero-Step")
The tool now **auto-creates** these for you when you run any command, but you still need to fill in your keys.

1.  Look for `.env.example` (or create a copy named `.env.local`).
2.  Add your API keys:
    - `GEMINI_API_KEY`: Get one for free at [Google AI Studio](https://aistudio.google.com/).
    - `GROQ_API_KEY`: Get one at [Groq Console](https://console.groq.com/).

## 3. Build the Brain (One-Time Setup)
This scans your codebase and creates a local search index in `.jstar/`.
```bash
pnpm run index:init
```

## 4. Run your first Review
Stage some changes first!
```bash
git add .
pnpm run review
```

---

## 🛠️ Auto-Healing Features
- **Missing `.jstar`?** We create it automatically.
- **Outdated `.env.example`?** We append missing keys automatically.
- **Forgot `.env.local`?** We'll remind you exactly what's missing.

## 💡 Pro Tip
Add the review command as a git hook or just run `jstar review` before you push.
