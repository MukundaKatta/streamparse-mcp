#!/usr/bin/env node
/**
 * streamparse MCP server.
 *
 * Exposes three tools to any MCP client (Claude Desktop, Cursor, Cline, Windsurf,
 * Zed, etc.):
 *
 *   parse_partial_json      — recover a partial / truncated JSON value
 *   extract_json_from_text  — strip prose / fences / comments and parse what's inside
 *   validate_json           — strict-mode validator with a precise error position
 *
 * Configure your client to spawn this binary over stdio. Example for Claude Desktop's
 * `claude_desktop_config.json`:
 *
 *   {
 *     "mcpServers": {
 *       "streamparse": {
 *         "command": "npx",
 *         "args": ["-y", "@mukundakatta/streamparse-mcp"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { JsonStreamParser, parsePartial } from '@mukundakatta/streamparse';

const server = new Server(
  {
    name: 'streamparse',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// --- tool catalog ---------------------------------------------------------

const TOOLS = [
  {
    name: 'parse_partial_json',
    description:
      'Parse a JSON string that may be truncated mid-stream (e.g. a partial LLM tool call). Always returns a valid JSON value with synthetic closure of any open strings, arrays, or objects. Reports whether the input represented a complete top-level value, plus the cursor path where parsing stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The JSON text to parse. May be truncated.',
        },
        lenient: {
          type: 'boolean',
          description:
            'When true (default), tolerates trailing commas, single quotes, unquoted keys, ```json fences, comments, and prose padding.',
          default: true,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_json_from_text',
    description:
      'Extract and parse a JSON value embedded in messy LLM output. Strips ```json fences, leading/trailing prose, code comments, and tolerates other LLM-isms. Returns the first parseable value and where in the text it started.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Free-form text that contains a JSON value somewhere inside.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'validate_json',
    description:
      'Strict-mode RFC 8259 validator. Returns ok=true and the parsed value if the input is valid JSON; otherwise returns ok=false with a precise byte position and human-readable message.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The JSON text to validate.',
        },
      },
      required: ['text'],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// --- tool dispatch --------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case 'parse_partial_json':
        return parsePartialTool(args as { text: string; lenient?: boolean });
      case 'extract_json_from_text':
        return extractJsonTool(args as { text: string });
      case 'validate_json':
        return validateJsonTool(args as { text: string });
      default:
        return errorResult('unknown tool: ' + name);
    }
  } catch (err) {
    return errorResult('internal error: ' + (err as Error).message);
  }
});

// --- tool implementations -------------------------------------------------

function parsePartialTool(args: { text: string; lenient?: boolean }) {
  const lenient = args.lenient ?? true;
  const parser = new JsonStreamParser({ lenient });
  let parseError: string | null = null;
  parser.on('error', (e) => {
    parseError = e.message;
  });
  parser.push(args.text);
  const snap = parser.snapshot();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            value: snap.value ?? null,
            complete: snap.complete,
            path: snap.path,
            bytes_consumed: snap.bytesIn,
            confidence: snap.confidence,
            parse_error: parseError,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function extractJsonTool(args: { text: string }) {
  // Lenient parsePartial already strips prose, fences, and comments.
  const value = parsePartial(args.text);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            value: value ?? null,
            extracted: value !== undefined,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function validateJsonTool(args: { text: string }) {
  const parser = new JsonStreamParser({ lenient: false });
  try {
    parser.push(args.text);
    parser.end();
    const snap = parser.snapshot();
    if (snap.complete) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: true, value: snap.value, bytes: snap.bytesIn },
              null,
              2,
            ),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ok: false, error: 'unexpected end of input', bytes: snap.bytesIn },
            null,
            2,
          ),
        },
      ],
    };
  } catch (e) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ok: false, error: (e as Error).message },
            null,
            2,
          ),
        },
      ],
    };
  }
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

// --- bootstrap ------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

// Polite log to stderr so MCP clients (which read stdout) aren't disturbed.
process.stderr.write('streamparse MCP server v1.0.0 ready on stdio\n');
