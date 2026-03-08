#!/usr/bin/env node
/**
 * mcp-server.js — MCP server for wearehere.
 *
 * Raw JSON-RPC 2.0 over stdio. No SDK dependency.
 * One tool: scan_site — full 360 privacy audit of any website.
 */

import { scanSite } from './src/scanner.js';

const TOOLS = [
  {
    name: 'scan_site',
    description: 'Full 360 privacy audit of any website. Navigates headless, scans for: cookies (1st/3rd party, persistence), hidden trackers (pixels, beacons, iframes, 3P scripts), device fingerprinting (Canvas, WebGL, Audio, Navigator probing), pressure tactics (fake urgency, confirm-shaming, countdown timers, pre-checked consent), local tracking data (localStorage/sessionStorage IDs), and link tracking (UTM params, redirect wrappers). Returns structured JSON with a plain-language finding per category, evidence, and an overall risk verdict with recommendation. One call, complete picture.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to scan (e.g. "https://example.com")',
        },
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['cookies', 'trackers', 'fingerprinting', 'pressure', 'storage', 'links'],
          },
          description: 'Optional: scan only specific categories. Omit to scan everything.',
        },
        timeout: {
          type: 'number',
          description: 'Navigation timeout in ms (default: 30000)',
        },
        settle: {
          type: 'number',
          description: 'Time to wait for trackers to load after page load, in ms (default: 3000)',
        },
      },
      required: ['url'],
    },
  },
];

async function handleToolCall(name, args) {
  if (name !== 'scan_site') throw new Error(`Unknown tool: ${name}`);

  const report = await scanSite(args.url, {
    categories: args.categories,
    timeout: args.timeout,
    settle: args.settle,
  });

  return JSON.stringify(report, null, 2);
}

function jsonrpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return jsonrpcResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'wearehere', version: '0.1.0' },
    });
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'tools/list') {
    return jsonrpcResponse(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = await handleToolCall(name, args || {});
      return jsonrpcResponse(id, {
        content: [{ type: 'text', text: result }],
      });
    } catch (err) {
      return jsonrpcResponse(id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      });
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`);
}

// --- Stdio transport ---

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;

    try {
      const msg = JSON.parse(line);
      const response = await handleMessage(msg);
      if (response) {
        process.stdout.write(response + '\n');
      }
    } catch (err) {
      process.stdout.write(jsonrpcError(null, -32700, `Parse error: ${err.message}`) + '\n');
    }
  }
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
