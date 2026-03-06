# Feature: CLI Reference

> **Status:** Production Ready
> **Entry Point:** `bin/jstar.js`, `package.json`

## Commands

### `jstar setup`
Creates or updates `.jstar/`, `.env.example`, and `.gitignore` entries.

### `jstar init`
Builds the local vector index used for context-aware reviews.

### `jstar review`
Runs the hybrid review pipeline:
- Deterministic security pass on the selected diff
- Context retrieval from the local index
- LLM review on diff chunks
- Dashboard output to `.jstar/last-review.md`

Supports:
- `--last`
- `--commit <hash>`
- `--range <start> <end>`
- `--pr`
- `--base <branch>`
- `--json`

### `jstar audit`
Runs the deterministic security audit pipeline and writes:
- `.jstar/audit_report.md`
- `.jstar/audit_report.json`

Supports:
- `--full` (default)
- `--path <dir-or-file>`
- `--last`
- `--commit <hash>`
- `--range <start> <end>`
- `--pr`
- `--base <branch>`
- `--json`

### `jstar detect`
Runs the deterministic rule engine as a fast static-only pass.

### `jstar chat`
Resumes the last review session for debate/ignore flows.
Use `--headless` for stdin/stdout JSON interaction.

## Example usage

```bash
# Build the local index
jstar init

# Review staged changes
jstar review

# Run a full security audit
jstar audit

# Get machine-readable output
jstar audit --json > .jstar/audit_report.json
```
