---
description: Run the deterministic J-Star security audit and use the report as the primary audit artifact.
---

# Deep Code Audit Protocol

## Primary command

Run the audit first instead of treating the audit as a manual grep exercise.

```bash
jstar audit
```

This writes:
- `.jstar/audit_report.md`
- `.jstar/audit_report.json`

## Scope options

### Full workspace
```bash
jstar audit
```

### Focused path
```bash
jstar audit --path src
```

### Change-based audit
```bash
jstar audit --last
jstar audit --pr
```

## Agent workflow

1. Run `jstar audit --json` when you need machine-readable output.
2. Fix `CRITICAL` and `HIGH` findings first.
3. Re-run the same audit scope to confirm the finding is gone.
4. If a deterministic finding is a false positive, add a narrow entry to `.jstar/audit-ignore.json`.
5. Use `jstar review --json` after the security pass when you also want LLM-backed code review on the same change set.

## Rules of engagement

- Do not broaden an ignore entry more than necessary.
- Prefer fixing the code over ignoring a rule.
- Treat tracked `.env`, `.pem`, and `.key` files as blockers until rotated or removed from history.
