# J Star Coding Rules

## General

- No `any` types unless absolutely necessary
- All functions must have explicit return types
- Use `async/await` over raw Promises

## Security

- Never log sensitive data (tokens, passwords, API keys)
- Validate all user input with Zod schemas
- Use parameterized queries, never string interpolation for SQL

## Performance

- Avoid N+1 queries
- Use pagination for list endpoints
- Memoize expensive computations
