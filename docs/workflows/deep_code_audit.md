# Deep Code Audit Workflow Blueprint

## Overview
This workflow supersedes the standard security audit, providing a "Senior Engineer in a Box" experience. It covers Security, Logic, Completeness (Spec vs Code), and Code Quality.

## Core Philosophy: "The Architect & The Judge"
We move beyond just finding bugs to evaluating the "Soul" of the code.
- **The Architect:** Cares about structure, patterns (FSD, Repository Pattern), and long-term maintainability.
- **The Judge:** Cares about correctness, edge cases, and security vulnerabilities.

## Workflow Stages

### Phase 0: Scope
- **FULL:** All files.
- **FEATURE:** Specific domain (e.g., `features/auth`).
- **DIFF:** Only what changed.

### Phase 1: The Detective (Static)
- **Dependencies:** `pnpm audit`.
- **Patterns:** Regex for secrets, `eval`, `TODO`, and dangerous functions.

### Phase 2: The Graph (Relational)
- **Trace:** User Input -> Route -> Service -> DB.
- **Validation:** Verify Zod at the edge.

### Phase 3: The Auditor (Completeness)
- **Spec Check:** Read `docs/features/*.md`.
- **Verify:** Does every requirement in the doc have a corresponding function?
- **Zombie Code:** Is there code that does nothing?

### Phase 4: The Judge (Logic)
- **Sandbox:** Mental simulation of attacks and edge cases (Null, Huge Payloads, Race Conditions).

### Phase 5: The Architect (Quality)
- **Performance:** N+1 checks (`await` in loops).
- **Clean Code:** Function length < 50 lines, no magic strings.
- **Types:** No `any`.

### Phase 6: Reporting
- **Output:** `.jstar/audit_report.md` with categorized findings.
