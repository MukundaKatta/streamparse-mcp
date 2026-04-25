# Publishing checklist

This document captures the exact steps to publish streamparse-mcp end-to-end. None
of it requires running anything from this checkout; the commands assume you are at
`/Users/ubl/streamparse-mcp` with credentials available via 1Password.

## Prereqs

- npm account with write to `@mukundakatta/streamparse-mcp` (already provisioned).
- `@mukundakatta/streamparse@1.0.1` published to npm. Until then this package's
  `dependencies."@mukundakatta/streamparse"` is a local `file:../streamparse` link
  for development.
- `mcp-publisher` CLI installed: `brew install mcp-publisher`.

## 1. Flip the dep to npm range

```bash
# In package.json, change "@mukundakatta/streamparse": "file:../streamparse"
# to: "@mukundakatta/streamparse": "^1.0.1"
```

## 2. Build, test, publish to npm

```bash
# Inside a fresh tmux session (per repo CLAUDE.md):
tmux new -d -s release-streamparse-mcp
eval "$(op signin --account my.1password.com)"

npm install
npm run build
npm test
npm publish --access public --otp="$(op read 'op://Private/Npmjs/one-time password?attribute=otp')"

# Verify:
npm view @mukundakatta/streamparse-mcp version --userconfig "$(mktemp)"
# Expected: 1.0.0
```

## 3. Publish to the MCP registry

```bash
mcp-publisher login github                    # opens browser for OAuth
mcp-publisher publish                         # uses ./server.json
```

The registry verifies that `mcpName` in package.json matches the `name` in
`server.json` and that the npm package metadata is consistent. If the verify
step fails, the most common causes are:

- `mcpName` missing from `package.json` (it must be the literal
  `io.github.mukundakatta/streamparse`).
- npm package version mismatch with `server.json` `packages[0].version`.
- npm package has not propagated yet (wait ~30s after publish).

## 4. Smoke-test the published server

```bash
npx -y @mukundakatta/streamparse-mcp
# Should print "streamparse MCP server v1.0.0 ready on stdio" to stderr,
# then wait on stdin. Ctrl-C to exit.

# Optional end-to-end with real Claude Desktop:
# Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
#   { "mcpServers": { "streamparse": { "command": "npx", "args": ["-y", "@mukundakatta/streamparse-mcp"] } } }
# Restart Claude Desktop. The streamparse tools appear in the tool drawer.
```

## 5. Release tag

```bash
git tag v1.0.0
git push --tags
gh release create v1.0.0 --title "streamparse-mcp v1.0.0" --notes-from-tag
```

## Rollback

If a publish goes wrong (e.g. accidental version bump, broken build):

```bash
npm deprecate @mukundakatta/streamparse-mcp@1.0.0 "use 1.0.1 instead"
# Then publish 1.0.1 with the fix. Never unpublish; npm only allows that for 72h.
```
