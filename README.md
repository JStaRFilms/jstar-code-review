# J-Star Code Reviewer

Local-first, context-aware code review with a deterministic security audit layer.

## What it does

- Builds a local vector index for repo-aware reviews
- Runs hybrid reviews with deterministic checks plus LLM analysis
- Produces machine-readable review output for automation
- Runs a standalone deterministic security audit with markdown and JSON reports

## Quick start

```bash
pnpm install
pnpm run index:init
git add .
pnpm run review
pnpm run audit
```

Review output:
- `.jstar/last-review.md`
- `.jstar/session.json`

Audit output:
- `.jstar/audit_report.md`
- `.jstar/audit_report.json`

## CLI

```bash
jstar setup
jstar init
jstar review
jstar review --pr
jstar audit
jstar audit --path src
jstar audit --json
jstar chat --headless
```

## Notes

- `review` requires `GEMINI_API_KEY` and `GROQ_API_KEY`
- `audit` and `detect` do not require model keys
- deterministic audit ignores live in `.jstar/audit-ignore.json`

See [ONBOARDING.md](./ONBOARDING.md) and [docs/features/cli-commands.md](./docs/features/cli-commands.md) for details.
