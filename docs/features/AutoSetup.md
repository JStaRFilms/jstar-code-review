# Feature: Auto-Setup & Onboarding

## Goal
Improve the "Day 0" experience for developers by automatically handling trivial configuration tasks and providing a clear path from installation to first review.

## Problem
1. **Ambiguous Order of Events**: Users aren't sure if they should `init`, `setup`, or `index` first.
2. **Manual Config Drift**: `.env.example` doesn't always stay in sync with the required keys.
3. **Implicit Dependencies**: Scripts fail if `.jstar/` is missing instead of just creating it.

## Implementation Details

### 1. Unified Onboarding Strategy
- **Step 1: Install** (`pnpm install`)
- **Step 2: Initialize** (`jstar init` or `pnpm run index:init`)
- **Step 3: Configure** (Fill `.env.local`)
- **Step 4: Execute** (`jstar review` or `pnpm run review`)

### 2. Auto-Healing Config (`scripts/config.ts`)
- **Environment Parity**: Every time `Config` is loaded, it will verify `.env.example` exists and has all required keys.
- **Directory Persistence**: Ensure `.jstar/` exists.
- **Validation**: Check for `GOOGLE_API_KEY` and `GROQ_API_KEY`. If missing, print a friendly warning with instructions instead of an ugly stack trace.

### 3. CLI Intelligence (`bin/jstar.js`)
- If `jstar review` is run and `.jstar` or `.env.local` is missing, proactively offer to run the setup logic.

## Verification Plan
1. Delete `.jstar/` and `.env.example`.
2. Run `pnpm run review`.
3. Verify that `.jstar/` is recreated and `.env.example` is repopulated.
4. Verify the user is warned about missing `.env.local`.
