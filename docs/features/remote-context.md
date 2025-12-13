# Remote Context Loading

Fetching project context from GitHub API instead of local filesystem.

## Problem
The bot runs in a GitHub Actions runner, which performs a shallow clone of the repo. Context files (`.jstar/rules.md`, `docs/features/*.md`) may not be present in the shallow clone, or might be stale.

## Solution
Use `Octokit.repos.getContent()` to fetch context files directly from the remote repository.

## Implementation

### Fetching Single Files
```typescript
async function fetchRemoteFile(ctx: GitHubContext, path: string): Promise<string | null> {
  const { data } = await ctx.octokit.repos.getContent({
    owner: ctx.owner,
    repo: ctx.repo,
    path: path,
  });
  return Buffer.from(data.content, 'base64').toString('utf-8');
}
```

### Loading Architecture Context
```typescript
const docs = [
  { name: 'ARCHITECTURE', file: '.jstar/architecture.md' },
  { name: 'CODING RULES', file: '.jstar/rules.md' }
];
for (const doc of docs) {
  const content = await fetchRemoteFile(ctx, doc.file);
  if (content) contextDocs += `\n### ${doc.name}:\n${content}\n`;
}
```

### Loading Docs Inventory
```typescript
async function loadDocsInventory(ctx: GitHubContext): Promise<Map<string, string>> {
  const { data } = await ctx.octokit.repos.getContent({
    path: 'docs/features',
  });
  // Parse directory listing and map feature names to file paths
}
```

## Benefits
- **Always Fresh:** Context is fetched from the latest commit on the branch.
- **No Clone Depth Issues:** Works even with `fetch-depth: 1` in Actions.
- **Stateless:** Bot doesn't rely on local filesystem state.

## Error Handling
- Returns `null` if file doesn't exist (404).
- Logs warning for other errors but doesn't crash.
