# Feature: Dashboard & Reporting

> **Status:** ✅ Production Ready  
> **Source:** `scripts/dashboard.ts`

## Overview

The **Dashboard Reporter** converts the raw findings from the Detective Engine and the LLM Reviewer into a human-readable Markdown report. It provides an immediate "At-a-Glance" status check and detailed actionable feedback.

## Output Location

The report is saved to:
`./.jstar/last-review.md`

## Report Structure

### 1. Header
Contains the Date, Reviewer ID, and overall Status Emoji.

### 2. Executive Summary (Metrics)
A table showing:
- **Files Scanned**: Coverage of the review.
- **Total Tokens**: Size of the change.
- **Violations**: Breakdown by severity (Critical, High, Medium, LGTM).

### 3. Issue Sections (Grouped by Severity)
Issues are grouped to help you prioritize checking blockers first.
- **🛑 CRITICAL (P0)**: Security leaks, auth bypasses.
- **⚠️ HIGH (P1)**: Major logic flaws.
- **📝 MEDIUM (P2)**: Cleanup, types, comments.
- **✅ LGTM**: Files that passed.

### 4. Smart Fix Prompts
For every issue, the dashboard generates a **Fix Prompt** inside a `<details>` toggle. You can copy-paste this prompt into your IDE's AI assistant (like Cursor or Copilot) to instantly fix the issue.

### 5. Recommended Action
A logic-based recommendation on how to proceed:
- **BLOCK MERGE**: If P0s exist.
- **Request Changes**: If P1s exist.
- **Approve with Notes**: If only P2s exist.
- **Approve**: If all clear.

## Logic

The status determination logic is configurable:
- **CRITICAL_FAILURE**: Any P0 issue.
- **NEEDS_REVIEW**: Any P1 issue OR Medium issues > Threshold (default 5).
- **APPROVED**: Everything else.
