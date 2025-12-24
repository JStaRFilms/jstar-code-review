# Workflow: J-Star Review Modes

J-Star now supports multiple review modes to fit different stages of development.

## 1. Staged Changes (Default)
**Use when:** You are currently coding and want to check your work before committing.
```bash
jstar review
```
*Equivalent to: `git diff --staged`*

## 2. Retroactive Review (The "Oops" Fix)
**Use when:** You already committed your changes but forgot to review them.
```bash
jstar review --last
```
*Equivalent to: `git diff HEAD~1 HEAD`*

## 3. Pull Request Review (Feature Branch)
**Use when:** You are working on a feature branch and want to see the full change set against `main`.
```bash
jstar review --pr
# OR specify a different base branch
jstar review --pr develop
```
*Equivalent to: `git diff main...HEAD` (triple-dot merge base diff)*

## 4. Specific Commit Strategy
**Use when:** You want to review a specific historical commit or a range of commits.
```bash
# Single Commit
jstar review --commit <commit-hash>

# Commit Range
jstar review --range <start-hash> <end-hash>
```

## Tips
- **Aliases**: You can add these to your `package.json` scripts if you use them often.
- **CI/CD**: The `--pr` flag is ideal for CI pipelines to run automated reviews on Pull Requests.
