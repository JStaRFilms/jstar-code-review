# J Star Architecture Context

This file provides the AI reviewer with context about the project's architecture.

## Project Structure

```
src/
  features/       # Feature-sliced design (each feature has its own folder)
  components/     # Shared UI components
  lib/            # Utilities and helpers
docs/
  features/       # Documentation for each feature (MUST mirror src/features/)
```

## Key Conventions

- Every feature in `src/features/NAME/` must have corresponding docs in `docs/features/NAME.md`
- Use TypeScript strict mode
- All API calls go through service files (`*.service.ts`)
