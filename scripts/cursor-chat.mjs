#!/usr/bin/env node
/**
 * Cursor: Send a chat request using an access token.
 *
 * Reuses 9router's own CursorExecutor so headers (x-cursor-checksum, etc.) and
 * the protobuf body are produced exactly like the running service does.
 *
 * Usage:
 *   node scripts/cursor-chat.mjs \
 *     --token <JWT> \
 *     --machine-id <UUID> \
 *     [--model claude-4.5-sonnet] \
 *     [--prompt "Hello"] \
 *     [--stream]
 *
 * Env fallback:
 *   CURSOR_ACCESS_TOKEN, CURSOR_MACHINE_ID, CURSOR_MODEL, CURSOR_PROMPT
 *
 * Tip: get token+machineId from `scripts/cursor-exchange-key.mjs`.
 */

import { CursorExecutor } from "../open-sse/executors/cursor.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const accessToken = (args.token || process.env.CURSOR_ACCESS_TOKEN || "").trim();
const machineId = (args["machine-id"] || process.env.CURSOR_MACHINE_ID || "").trim();
const model = (args.model || process.env.CURSOR_MODEL || "claude-4.5-sonnet").trim();
const prompt = (args.prompt || process.env.CURSOR_PROMPT || "Say hi in one short sentence.").trim();
const stream = !!args.stream;

if (!accessToken || !machineId) {
  console.error("Usage:");
  console.error("  node scripts/cursor-chat.mjs --token <JWT> --machine-id <UUID> [--model <name>] [--prompt <text>] [--stream]");
  console.error("Env: CURSOR_ACCESS_TOKEN, CURSOR_MACHINE_ID, CURSOR_MODEL, CURSOR_PROMPT");
  process.exit(1);
}

const credentials = {
  accessToken,
  providerSpecificData: {
    machineId,
    ghostMode: true,
  },
};

const body = {
  model,
  stream,
  messages: [
    { role: "user", content: prompt },
  ],
};

const executor = new CursorExecutor();

const t0 = Date.now();
const { response } = await executor.execute({
  model,
  body,
  stream,
  credentials,
});
const ms = Date.now() - t0;

console.error(`[cursor-chat] HTTP ${response.status} in ${ms}ms`);

if (response.status !== 200) {
  const text = await response.text();
  console.error(text);
  process.exit(2);
}

if (stream) {
  // SSE: print raw stream so the user can see chunks as the executor emits them
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value, { stream: true }));
  }
  process.stdout.write("\n");
} else {
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content || "";
  console.log("--- content ---");
  console.log(content);
  console.log("--- raw ---");
  console.log(JSON.stringify(json, null, 2));
}
