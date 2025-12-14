# 🚀 Spawning J Star Review in Your Repository

This guide shows you how to add J Star Code Review to **any** GitHub repository in under 2 minutes.

## Quick Start (One-Time Setup)

### Step 1: Add the Workflow File

Create this file in your target repository:

**`.github/workflows/jstar-review.yml`**

```yaml
name: J Star Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  check:
    name: 🔍 Check Trigger
    runs-on: ubuntu-latest
    outputs:
      should_run: ${{ steps.check.outputs.should_run }}
    steps:
      - name: Check if should run
        id: check
        run: |
          if [[ "${{ github.event_name }}" == "pull_request" ]]; then
            echo "should_run=true" >> $GITHUB_OUTPUT
          elif [[ "${{ github.event_name }}" == "issue_comment" && \
                  "${{ contains(github.event.comment.body, '/review') }}" == "true" && \
                  "${{ github.event.issue.pull_request != null }}" == "true" ]]; then
            echo "should_run=true" >> $GITHUB_OUTPUT
          else
            echo "should_run=false" >> $GITHUB_OUTPUT
          fi

  review:
    name: 🌟 J Star Review
    needs: check
    if: needs.check.outputs.should_run == 'true'
    uses: JStaRFilms/jstar-code-review/.github/workflows/reusable-review.yml@main
    secrets:
      GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

### Step 2: Add Your API Key

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `GROQ_API_KEY`
4. Value: Your Groq API key from [console.groq.com](https://console.groq.com)

**Done!** 🎉 The bot will now run on every PR.

---

## Optional: Add Project Context

For smarter reviews tailored to your codebase, add a `.jstar/` folder:

```
your-repo/
├── .github/workflows/jstar-review.yml  # The workflow (required)
└── .jstar/                             # Optional project context
    ├── rules.md                        # Your coding guidelines
    └── architecture.md                 # Project structure overview
```

### Example `.jstar/rules.md`

```markdown
# Project Coding Rules

## General
- Use TypeScript strict mode
- No `any` types unless absolutely necessary
- All functions must have explicit return types

## Security
- Never log sensitive data (tokens, passwords, API keys)
- Validate all user input with Zod schemas
```

### Example `.jstar/architecture.md`

```markdown
# Project Architecture

## Tech Stack
- Next.js 14 (App Router)
- PostgreSQL + Prisma
- Tailwind CSS

## Folder Structure
- `src/app/` - Next.js routes
- `src/features/` - Feature modules
- `src/lib/` - Shared utilities
```

---

## Customizing Models

You can customize which AI models the bot uses:

```yaml
review:
  uses: JStaRFilms/jstar-code-review/.github/workflows/reusable-review.yml@main
  secrets:
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
  with:
    triage_model: 'openai/gpt-oss-120b'      # Fast/cheap for initial classification
    triage_model: 'openai/gpt-oss-120b'      # Fast/cheap for initial classification
    analyst_model: 'moonshotai/kimi-k2-instruct-0905'  # Powerful for deep review
```

### Tuning Performance (Optional)

If you are hitting rate limits (429 errors), you can tune the concurrency via **Secrets** or **Variables**:

- `AI_CONCURRENCY`: Set to `1` (default) for safety, or `3-5` for speed.
- `AI_MAX_RETRIES`: Default `3`.
- `AI_RETRY_DELAY`: Default `2000` (ms).

---

## Manual Review Trigger

Comment `/review` on any PR to trigger a review manually.

---

## Questions?

Open an issue at [JStaRFilms/jstar-code-review](https://github.com/JStaRFilms/jstar-code-review/issues).

---

## Troubleshooting

### Duplicate Runs
If the bot runs twice on every PR, check that you don't have multiple workflow files triggering on `pull_request`.
- Common Duplicate: `spawn-template.yml` if it was accidentally moved to `.github/workflows/`. Ensure templates stay in `.github/` (root) or are renamed/disabled.
