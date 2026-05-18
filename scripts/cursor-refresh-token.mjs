#!/usr/bin/env node
/**
 * Cursor: Refresh access token using the stored long-lived API key.
 *
 * Thin wrapper around CursorExecutor.refreshCredentials() — i.e. the *exact*
 * code path 9router uses on proactive refresh / 401 fallback.
 *
 * Usage:
 *   node scripts/cursor-refresh-token.mjs --api-key <crsr_...> [--machine-id <UUID>]
 *
 * Env fallback:
 *   CURSOR_API_KEY, CURSOR_MACHINE_ID
 *
 * Output (JSON, stdout): { accessToken, refreshToken, expiresIn, expiresAt,
 *                         providerSpecificData }
 */

import crypto from "node:crypto";
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
const apiKey = (args["api-key"] || process.env.CURSOR_API_KEY || "").trim();
const machineId = (args["machine-id"] || process.env.CURSOR_MACHINE_ID || crypto.randomUUID()).trim();

if (!apiKey) {
  console.error("Usage:");
  console.error("  node scripts/cursor-refresh-token.mjs --api-key <crsr_...> [--machine-id <UUID>]");
  console.error("Env: CURSOR_API_KEY, CURSOR_MACHINE_ID");
  process.exit(1);
}
if (!apiKey.startsWith("crsr_")) {
  console.error("Error: Cursor API key must start with 'crsr_'");
  process.exit(1);
}

const credentials = {
  providerSpecificData: {
    apiKey,
    machineId,
    authMethod: "apikey",
  },
};

const log = {
  info: (tag, msg) => console.error(`[${tag}] ${msg}`),
  warn: (tag, msg) => console.error(`[${tag}] WARN ${msg}`),
  error: (tag, msg) => console.error(`[${tag}] ERROR ${msg}`),
};

const executor = new CursorExecutor();
const result = await executor.refreshCredentials(credentials, log);

if (!result?.accessToken) {
  console.error("Refresh failed: no accessToken returned");
  process.exit(2);
}

const out = {
  ...result,
  expiresAt: new Date(Date.now() + result.expiresIn * 1000).toISOString(),
};

console.log(JSON.stringify(out, null, 2));
