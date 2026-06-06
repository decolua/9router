# 9router Fork — Project Notes

## Build & Deploy Gotchas

### Clearing stale webpack cache
When editing source in `open-sse/` (or anywhere outside `src/`), the Next.js webpack cache can cause the compiled bundle to retain old code even after a rebuild.

**Always do this before rebuilding the CLI:**
```bash
rm -rf .next-cli-build/cache/webpack
# Or nuke the whole build dir to be safe:
rm -rf .next-cli-build
```

Then rebuild:
```bash
cd cli && npm run build
```

### Global install must be a symlink to the fork
`npm install -g` from the built tarball creates a standalone copy. After that, edits in the fork are invisible to the running server.

**Keep the global install synced:**
```bash
rm -rf /opt/homebrew/lib/node_modules/9router
ln -s /Users/justinadams/9router-fork/cli /opt/homebrew/lib/node_modules/9router
```

### Headless server launch
The `9router` CLI wrapper (`cli.js`) detects non-interactive TTY and auto-exits with a tray-mode fallback. For headless deployment, run the server directly:
```bash
PORT=3456 HOSTNAME=0.0.0.0 node /opt/homebrew/lib/node_modules/9router/app/server.js
```

## Anthropic API — Built-in Tool `model` Prefix Bug

**Symptom:** `invalid_request_error` (400) with messages like `tools.62.model: cc/claude-opus-4-6`.

**Root cause:** `prepareClaudeRequest` in `open-sse/translator/helpers/claudeHelper.js` was passing through built-in tool properties (including `model`) without stripping the provider prefix (`cc/`). Anthropic rejects prefixed model names.

**Fix location:** `open-sse/translator/helpers/claudeHelper.js` lines ~196-208

**Logic:** For built-in tools (`type !== "function"`), strip any provider prefix from `model` before sending:
```javascript
if (!tool.type || tool.type === "function") {
  // Client tools — strip model and type
  const { model, type, ...clientRest } = rest;
  cleanedTool = { ...clientRest };
} else {
  // Built-in tools — preserve all properties, but strip provider prefix from model
  cleanedTool = { ...rest };
  if (typeof cleanedTool.model === "string" && cleanedTool.model.includes("/")) {
    cleanedTool.model = cleanedTool.model.slice(cleanedTool.model.indexOf("/") + 1);
  }
}
```

**Verification:** After rebuilding, grep the compiled chunk for the fix:
```bash
grep "model.slice.*indexOf.*+1" cli/app/.next-cli-build/server/chunks/7540.js
```
