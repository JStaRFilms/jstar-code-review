# J-Star Reviewer

Local-first, context-aware AI code review for any Git-based project.

J-Star Reviewer combines a local repository index, deterministic security checks, and LLM-assisted review so you can inspect staged changes, pull request diffs, commits, or full audit scopes from the command line.

## Why use it

- Reviews changes with repository context instead of isolated diffs
- Runs deterministic security checks alongside AI review
- Supports staged changes, PR-style comparisons, commit hashes, and ranges
- Produces Markdown and JSON outputs for local workflows or automation
- Keeps a reusable `.jstar` workspace inside the project being reviewed

## What you can do

- `jstar init` builds the local index
- `jstar review` reviews staged changes or a selected diff target
- `jstar audit` runs the deterministic security audit pipeline
- `jstar detect` runs a faster static-only rules pass
- `jstar chat` resumes the last review session
- `jstar setup` prepares `.jstar/`, `.env.example`, and `.gitignore`

## Requirements

Before installing on a PC, make sure the machine has:

- Node.js `18` or newer
- `npm` (included with Node.js)
- `pnpm` (optional alternative to npm)
- Git

For AI-powered review features, you will also need:

- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `GROQ_API_KEY`

If you only want deterministic scanning, `jstar audit` and `jstar detect` can still be useful without model keys.

## Install On Someone's PC

There are two common ways to get this onto a computer.

### Option 1: Install the published CLI globally

This is the easiest option if the person just wants to use the tool.

```bash
npm install -g jstar-reviewer
```

With `pnpm`:

```bash
pnpm add -g jstar-reviewer
```

Then confirm the install:

```bash
jstar --help
```

### Option 2: Download the source code to a local machine

Use this if the person wants the full project folder, wants to edit the code, or wants to run it from source.

#### Clone with Git

```bash
git clone https://github.com/JStaRFilms/jstar-code-review.git
cd jstar-code-review
npm install
```

With `pnpm`:

```bash
git clone https://github.com/JStaRFilms/jstar-code-review.git
cd jstar-code-review
pnpm install
```

#### Or download the ZIP from GitHub

1. Open the repository in a browser.
2. Click `Code`.
3. Click `Download ZIP`.
4. Extract the ZIP to the PC.
5. Open the extracted folder in PowerShell or Terminal.
6. Run `npm install` or `pnpm install`.

## Quick Start

If you installed the CLI globally, open a terminal inside the repository you want to review and run:

```bash
jstar setup
```

Then create a local env file from the generated template:

```bash
copy .env.example .env.local
```

On macOS or Linux, use:

```bash
cp .env.example .env.local
```

With `pnpm`, the setup command stays the same:

```bash
jstar setup
```

Add your keys to `.env.local`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GROQ_API_KEY=your_groq_api_key_here
```

Build the local index:

```bash
jstar init
```

If you are running from source instead of a global install, you can also use:

```bash
npm run index:init
```

Or with `pnpm`:

```bash
pnpm run index:init
```

Stage the code you want reviewed, then run:

```bash
git add .
jstar review
```

From source, the equivalents are:

```bash
npm run review
```

```bash
pnpm run review
```

Run a deterministic audit at any time:

```bash
jstar audit
```

From source, you can also run:

```bash
npm run audit
```

```bash
pnpm run audit
```

## Output Files

Review output:

- `.jstar/last-review.md`
- `.jstar/session.json`

Audit output:

- `.jstar/audit_report.md`
- `.jstar/audit_report.json`

## CLI Usage

### Core commands

```bash
jstar setup
jstar init
jstar review
jstar audit
jstar detect
jstar chat
```

### Review examples

```bash
# Review staged changes
jstar review

# Review a pull request diff against main
jstar review --pr

# Review against a different base branch
jstar review --pr --base develop

# Review the latest commit
jstar review --last

# Review a specific commit
jstar review --commit <hash>

# Review a ref range
jstar review --range <start> <end>
```

### Audit examples

```bash
# Full workspace audit
jstar audit

# Audit a specific path
jstar audit --path src

# Audit output as JSON
jstar audit --json
```

### Automation-friendly usage

```bash
# Machine-readable review output
jstar review --json

# Resume the last review session in headless mode
jstar chat --headless
```

## Typical Workflow

```bash
jstar setup
jstar init
git add .
jstar review
jstar audit
```

For later runs, you usually only need:

```bash
git add .
jstar review
```

Re-run `jstar init` when the codebase changes significantly and you want the local context index refreshed.

## Notes

- `jstar review` requires valid AI API keys
- `jstar audit` is the deterministic security-focused scan
- `jstar detect` is the lighter static-only pass
- `jstar setup` updates `.env.example` and `.gitignore` in the current project
- Audit ignore rules live in `.jstar/audit-ignore.json`

## Development

If you are working on this package itself:

```bash
npm install
npm run build
npm test
```

With `pnpm`:

```bash
pnpm install
pnpm run build
pnpm test
```

Useful package scripts:

- `npm run index:init`
- `pnpm run index:init`
- `npm run review`
- `pnpm run review`
- `npm run audit`
- `pnpm run audit`
- `npm run chat`
- `pnpm run chat`
- `npm run detect`
- `pnpm run detect`
- `npm test`
- `pnpm test`

## Publishing

This package is published on npm as `jstar-reviewer` and exposes the `jstar` CLI.

To publish a new version:

```bash
npm login
npm publish
```

## License

MIT

## Links

- Repository: https://github.com/JStaRFilms/jstar-code-review
- npm package: https://www.npmjs.com/package/jstar-reviewer

Last reviewed: 2026-03-07
