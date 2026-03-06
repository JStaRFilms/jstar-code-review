# Deep Code Audit Workflow Blueprint

## Overview

`jstar audit` is now the deterministic security-audit backbone for this repo.
It turns the older prose-only audit checklist into a repeatable rule pass with:

- Fixed rule inputs
- Stable file selection
- Structured JSON and markdown output
- Explicit ignore handling through `.jstar/audit-ignore.json`

## Recommended Modes

### Full audit
Run this for release readiness or broad security review.

```bash
jstar audit
```

Output:
- `.jstar/audit_report.md`
- `.jstar/audit_report.json`

### Focused audit
Use this when you only want to audit a specific area.

```bash
jstar audit --path src
jstar audit --path app/api
```

### Diff audit
Use the same diff selectors as `jstar review` when you want deterministic security checks on a change set.

```bash
jstar audit --last
jstar audit --pr
jstar audit --range main HEAD
```

## What the Audit Covers

### Deterministic file rules
- Hardcoded secrets
- Dynamic code execution (`eval`, `Function`)
- Unsafe raw SQL helpers
- Raw HTML injection sinks
- Server-only env vars referenced in client modules
- Misplaced `"use client"` directives
- `console.log` and `TODO` markers as lower-severity hygiene checks

### Repository guardrails
- Sensitive files tracked in git
- Missing `.gitignore`
- Missing sensitive `.gitignore` patterns

## Output Model

The JSON report is machine-readable and stable enough for automation:

```ts
interface AuditReport {
  date: string;
  mode: string;
  target: string;
  rulesVersion: string;
  summary: {
    filesScanned: number;
    findings: number;
    critical: number;
    high: number;
    warning: number;
    info: number;
    ignored: number;
  };
  findings: AuditFinding[];
  ignoredFindings: AuditFinding[];
  recommendedAction: string;
}
```

## False Positive Handling

Ignored findings live in `.jstar/audit-ignore.json`.

Example:

```json
{
  "ignores": [
    {
      "ruleId": "SEC-002",
      "file": "src/eval.ts",
      "line": 2,
      "reason": "Intentional sandbox fixture"
    }
  ]
}
```

Ignored findings are removed from active results and tracked separately in the report.
