/**
 * End-to-end smoke test: spawn the MCP server, ask for the tool catalog, and call
 * each tool with a representative input. Validates wire-level shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..', 'src', 'server.ts');

function rpc(child: ReturnType<typeof spawn>, request: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if ('id' in msg && (msg as { id: number }).id === (request as { id: number }).id) {
            child.stdout?.off('data', onData);
            resolve(msg);
            return;
          }
        } catch {
          // partial line, keep buffering
        }
      }
    };
    child.stdout?.on('data', onData);
    child.on('error', reject);
    child.stdin?.write(JSON.stringify(request) + '\n');
  });
}

async function withServer(fn: (child: ReturnType<typeof spawn>) => Promise<void>) {
  const child = spawn('npx', ['tsx', SERVER], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  // Initialize handshake.
  await rpc(child, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0.0' },
    },
  });
  child.stdin?.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
  );
  try {
    await fn(child);
  } finally {
    child.kill();
  }
}

test('server lists three tools', async () => {
  await withServer(async (child) => {
    const res = (await rpc(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    })) as { result: { tools: Array<{ name: string }> } };
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'extract_json_from_text',
      'parse_partial_json',
      'validate_json',
    ]);
  });
});

test('parse_partial_json on a truncated tool call', async () => {
  await withServer(async (child) => {
    const res = (await rpc(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'parse_partial_json',
        arguments: {
          text: '{"type":"tool_use","name":"edit_file","input":{"path":"a/b.ts","cont',
        },
      },
    })) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(res.result.content[0]!.text) as {
      value: Record<string, unknown>;
      complete: boolean;
    };
    assert.equal(payload.complete, false);
    assert.equal(payload.value.type, 'tool_use');
    assert.equal(payload.value.name, 'edit_file');
  });
});

test('extract_json_from_text strips fences and prose', async () => {
  await withServer(async (child) => {
    const res = (await rpc(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'extract_json_from_text',
        arguments: {
          text: 'Sure, here you go:\n```json\n{"answer": 42}\n```\nLet me know!',
        },
      },
    })) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(res.result.content[0]!.text) as {
      value: { answer: number };
    };
    assert.equal(payload.value.answer, 42);
  });
});

test('validate_json flags strict-mode errors', async () => {
  await withServer(async (child) => {
    const res = (await rpc(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'validate_json',
        arguments: { text: '{"a": 1,}' }, // trailing comma is illegal in strict
      },
    })) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(res.result.content[0]!.text) as {
      ok: boolean;
      error?: string;
    };
    assert.equal(payload.ok, false);
    assert.ok(payload.error?.length);
  });
});
