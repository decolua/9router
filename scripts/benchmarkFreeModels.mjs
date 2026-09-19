#!/usr/bin/env node
// Benchmark all `:free` chat models on an OpenAI-compatible base URL (e.g. unorouter, kktoken).
//
// Single provider:
//   BASE_URL=https://api.unorouter.com/v1 API_KEY=sk-... node scripts/benchmarkFreeModels.js [--limit=10] [--prompt="..."]
//
// Pre-registered providers (scripts/freeModelProviders.json), only `enabled: true` ones:
//   node scripts/benchmarkFreeModels.js --all [--limit=10]
//   (reads API key from each provider's `apiKeyEnv` — set that env var before running)
//
// Prints a markdown table to stdout — paste directly into a Postman collection description
// or CLAUDE.md notes. No deps beyond Node's built-in fetch (Node 18+).
//
// ponytail: no retry/backoff, no concurrency — sequential + simple. Add if benchmarking >50 models regularly.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT = process.argv.find(a => a.startsWith("--prompt="))?.slice("--prompt=".length)
  || "Reply in exactly one short sentence: what is 12*7?";
const LIMIT = Number(process.argv.find(a => a.startsWith("--limit="))?.slice("--limit=".length)) || Infinity;
const RUN_ALL = process.argv.includes("--all");

function loadEnabledProviders() {
  const configPath = join(__dirname, "freeModelProviders.json");
  const { providers } = JSON.parse(readFileSync(configPath, "utf8"));
  return providers.filter(p => p.enabled);
}

async function listFreeModels(baseUrl, apiKey) {
  const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`GET /models failed: ${res.status}`);
  const { data } = await res.json();
  return data
    .filter(m => m.id.endsWith(":free"))
    .filter(m => (m.supported_endpoint_types || []).includes("openai"))
    .filter(m => !(m.supported_endpoint_types || []).includes("embedding"))
    .filter(m => !["ai horde", "runware"].includes(m.owned_by));
}

async function testModel(baseUrl, apiKey, id) {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: id, messages: [{ role: "user", content: PROMPT }], stream: false }),
    });
    const elapsedMs = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { id, status: res.status, elapsedMs, ok: false, note: body?.error?.message || body?.error?.code || "error" };
    }
    const content = body?.choices?.[0]?.message?.content?.trim() || "(empty)";
    return { id, status: res.status, elapsedMs, ok: true, note: content.slice(0, 80) };
  } catch (err) {
    return { id, status: 0, elapsedMs: Date.now() - start, ok: false, note: err.message };
  }
}

async function runProvider(baseUrl, apiKey, label) {
  const models = (await listFreeModels(baseUrl, apiKey)).slice(0, LIMIT);
  console.error(`Testing ${models.length} free models against ${label} ...`);

  const results = [];
  for (const m of models) {
    const r = await testModel(baseUrl, apiKey, m.id);
    results.push(r);
    console.error(`${r.ok ? "OK  " : "FAIL"} ${m.id} — ${r.status} — ${r.elapsedMs}ms`);
  }

  results.sort((a, b) => (a.ok === b.ok ? a.elapsedMs - b.elapsedMs : a.ok ? -1 : 1));

  console.log(`\n### ${label}\n`);
  console.log(`| Model | HTTP | Latency | Notes |`);
  console.log(`|---|---|---|---|`);
  for (const r of results) {
    console.log(`| ${r.id} | ${r.status} | ${(r.elapsedMs / 1000).toFixed(1)}s | ${r.note.replace(/\|/g, "/")} |`);
  }
}

async function main() {
  if (RUN_ALL) {
    const providers = loadEnabledProviders();
    if (!providers.length) {
      console.error("No enabled providers in scripts/freeModelProviders.json — set \"enabled\": true on at least one.");
      process.exit(1);
    }
    for (const p of providers) {
      const apiKey = process.env[p.apiKeyEnv];
      if (!apiKey) {
        console.error(`Skipping ${p.id}: env var ${p.apiKeyEnv} not set`);
        continue;
      }
      await runProvider(p.baseUrl, apiKey, p.id);
    }
    return;
  }

  const BASE_URL = process.env.BASE_URL;
  const API_KEY = process.env.API_KEY;
  if (!BASE_URL || !API_KEY) {
    console.error("Usage: BASE_URL=<base> API_KEY=<key> node scripts/benchmarkFreeModels.js [--limit=N] [--prompt=\"...\"]");
    console.error("   or: node scripts/benchmarkFreeModels.js --all   (uses scripts/freeModelProviders.json)");
    process.exit(1);
  }
  await runProvider(BASE_URL, API_KEY, BASE_URL);
}

main().catch(err => { console.error(err); process.exit(1); });
