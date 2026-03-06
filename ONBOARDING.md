# J-Star Reviewer: Quick Start Guide

## 1. Install dependencies

```bash
pnpm install
```

## 2. Add local keys

Create `.env.local` from `.env.example` and set:
- `GEMINI_API_KEY`
- `GROQ_API_KEY`

## 3. Build the local index

```bash
pnpm run index:init
```

## 4. Run a review

Stage changes first, then:

```bash
git add .
pnpm run review
```

This produces:
- `.jstar/last-review.md`
- `.jstar/session.json`

## 5. Run a security audit

```bash
pnpm run audit
```

This produces:
- `.jstar/audit_report.md`
- `.jstar/audit_report.json`

## 6. Handle deterministic false positives

Add narrow ignore entries to `.jstar/audit-ignore.json` when a rule is intentionally violated and understood.
