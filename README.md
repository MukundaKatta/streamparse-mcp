# streamparse-mcp

[![npm](https://img.shields.io/npm/v/@mukundakatta/streamparse-mcp.svg)](https://www.npmjs.com/package/@mukundakatta/streamparse-mcp)
[![tests](https://img.shields.io/badge/tests-4%20passing-brightgreen.svg)](#)
[![mcp](https://img.shields.io/badge/protocol-MCP-blue.svg)](https://modelcontextprotocol.io)

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants the
ability to parse partial / messy / truncated JSON.

Built on top of [`@mukundakatta/streamparse`](https://github.com/MukundaKatta/streamparse).
Works with Claude Desktop, Cursor, Cline, Windsurf, Zed, and any other MCP client.

## Tools exposed

### `parse_partial_json`

Recover a JSON value from a possibly-truncated string. Always returns a valid
value with synthetic closure of any open strings, arrays, or objects.

```json
{
  "text": "{\"type\":\"tool_use\",\"name\":\"edit_file\",\"input\":{\"path\":\"a/b.ts\",\"cont"
}
```

→

```json
{
  "value": {
    "type": "tool_use",
    "name": "edit_file",
    "input": { "path": "a/b.ts", "cont": null }
  },
  "complete": false,
  "path": ["input", "cont"],
  "bytes_consumed": 67,
  "confidence": 0.65
}
```

### `extract_json_from_text`

Strip prose, ` ```json ` fences, and comments around a JSON value embedded in
LLM output. Returns the first parseable value.

```
Sure, here you go:
```json
{ "answer": 42 }
```
Let me know!
```

→ `{ "answer": 42 }`

### `validate_json`

Strict-mode RFC 8259 validator. Returns `ok=true` and the parsed value on
success, or `ok=false` with a precise byte position and error message on
failure.

## Install

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "streamparse": {
      "command": "npx",
      "args": ["-y", "@mukundakatta/streamparse-mcp"]
    }
  }
}
```

### Cursor / Cline / Windsurf / Zed

Same shape, in the appropriate `mcp.json` for your client. Most clients
auto-discover via `npx -y @mukundakatta/streamparse-mcp`.

### Local install

```bash
npm install -g @mukundakatta/streamparse-mcp
mcp-streamparse        # listens on stdio
```

## Why this matters

When an LLM is mid-tool-call and you need the assistant to reason about the
half-formed JSON it just wrote, no other tool gives a usable answer. Standard
`JSON.parse` throws. Regex extraction misses nested structure. This MCP server
gives Claude (or whichever model is driving) a real handle on partial JSON,
right where it lives.

## License

MIT.
