# Feature: Detective Engine

> **Status:** ✅ Production Ready  
> **Source:** `scripts/detective.ts`

## Overview

The **Detective Engine** is a deterministic static analysis tool designed to catch low-hanging fruit and security risks *before* the LLM review process begins. It uses regular expressions to enforce architectural rules and security best practices.

## How it Works

1.  **Scanning**: Recursively walks the source directory (smartly detected or provided).
2.  **Filtering**: Only checks `.ts`, `.tsx`, `.js`, `.jsx` files.
3.  **Analysis**: Applies a set of `Rule` objects to exactly match patterns in code.
4.  **Reporting**: Outputs violations to the console and passes them to the main Reviewer pipeline.

## Rules

The engine currently enforces the following rules:

### Security Rules (High Severity)
| ID | Rule | Description | Pattern |
|----|------|-------------|---------|
| **SEC-001** | Hardcoded Secrets | Detects potential API keys, passwords, or tokens in strings. | `/(api_key\|secret\|password\|token)\s*[:=]\s*['"\`][a-zA-Z0-9_\-\.]{10,}['"\`]/i` |

### Architectural Rules
| ID | Severity | Rule | Description |
|----|----------|------|-------------|
| **ARCH-001** | Medium | No Console Logs | Discourages `console.log` in production code. |
| **ARCH-002** | High | "use client" Placement | Ensures Next.js `"use client"` directive is at the very top of `tsx`/`ts` files. |

## CLI Usage

You can run the Detective Engine independently of the full review process:

```bash
pnpm run detect
```

## Integration

The Detective Engine is automatically invoked by the main Reviewer (`scripts/reviewer.ts`) at the start of every review. Violations found by the Detective are aggregated into the final Dashboard Report alongside LLM-based findings.
