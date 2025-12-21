---
description: Run the J-Star Code Reviewer loop to analyze and fix code quality issues.
---

# J-Star Code Review Workflow

This workflow executes the J-Star Reviewer on staged changes, allowing the agent to iteratively fix issues.

## 1. Build the Brain (Required once)
If you haven't indexed the project yet, or if major files have changed, run:
```bash
pnpm run index:init
```

## 2. Stage Current Changes
Ensure all recent changes are staged so the reviewer can see them.
// turbo
```bash
git add .
```

## 3. Run Reviewer
Execute the review pipeline.
```bash
pnpm run review
```

## 4. Analyze and Fix
**Agent Instructions:**
1.  **Read the Output**: Check `.jstar/last-review.md` or the console summary.
2.  **Prioritize**: Focus *only* on **P0_CRITICAL** and **P1_HIGH** issues first.
3.  **Looping Strategy**:
    - **IF** P0/P1 issues are found:
        - Apply fixes to the code.
        - Restart this workflow (Stage -> Review).
    - **IF** only P2_MEDIUM issues remain:
        - You may fix them if they are quick/obvious.
        - Otherwise, consider the code "Good Enough" and stop.
    - **MAX LOOPS**: 3. Do not run this cycle more than 3 times. If issues persist, stop and ask the user.

