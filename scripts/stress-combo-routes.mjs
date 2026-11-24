#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const COMBO_NAME = process.argv[2] || "gpt-5.4-mini";
const DB_PATH = process.env.NINE_ROUTER_DB || join(homedir(), ".9router", "db", "data.sqlite");
const BASE_URL = (process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.NINE_ROUTER_PROBE_TIMEOUT_MS || 25_000);

function sqliteScalar(sql) {
  return execFileSync("sqlite3", ["-noheader", DB_PATH, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sanitize(value) {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk[-_][A-Za-z0-9._-]+/g, "[redacted-key]")
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 150);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function errorCategory(status, payload) {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "provider_or_router_5xx";
  return sanitize(payload?.error?.message || payload?.error || payload?.message || payload?.msg || `http_${status}`);
}

function textFrom(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("");
  return "";
}

async function post(apiKey, path, body) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - started);
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok || payload?.error) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        error: errorCategory(response.status, payload),
        retryAfter: response.headers.get("retry-after") || null,
      };
    }
    return { ok: true, status: response.status, latencyMs, payload };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Math.round(performance.now() - started),
      error: error?.name === "TimeoutError" ? "timeout" : sanitize(error?.message),
      retryAfter: null,
    };
  }
}

async function chatProbe(apiKey, model, id) {
  const result = await post(apiKey, "/v1/chat/completions", {
    model,
    stream: false,
    temperature: 0,
    max_tokens: 128,
    messages: [{ role: "user", content: `Reply with exactly MATRIX_OK_${id}.` }],
  });
  if (!result.ok) return result;
  const text = textFrom(result.payload).trim();
  return {
    ok: true,
    semanticOk: text === `MATRIX_OK_${id}`,
    nonEmpty: text.length > 0,
    status: result.status,
    latencyMs: result.latencyMs,
  };
}

async function responsesSmoke(apiKey, model) {
  const result = await post(apiKey, "/v1/responses", {
    model,
    stream: false,
    max_output_tokens: 128,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with exactly CODEX_OK." }] }],
  });
  if (!result.ok) return result;
  return {
    ok: result.payload?.object === "response" && Array.isArray(result.payload?.output),
    transportOk: true,
    status: result.status,
    latencyMs: result.latencyMs,
    object: result.payload?.object || null,
  };
}

async function stressRoute(apiKey, model, listed, sequenceStart) {
  const smoke = await chatProbe(apiKey, model, sequenceStart);
  const result = { model, listed, smoke, stress: null, responses: null };
  if (!smoke.ok) return result;

  const probes = [];
  for (let i = 0; i < 3; i += 1) probes.push(await chatProbe(apiKey, model, sequenceStart + i + 1));

  const concurrent = await Promise.all(
    Array.from({ length: 4 }, (_, i) => chatProbe(apiKey, model, sequenceStart + i + 4))
  );
  const all = [...probes, ...concurrent];
  const latencies = all.map((entry) => entry.latencyMs).filter(Number.isFinite);
  const errors = {};
  for (const entry of all.filter((entry) => !entry.ok)) errors[entry.error || "unknown"] = (errors[entry.error || "unknown"] || 0) + 1;
  result.stress = {
    requests: all.length,
    sequential: { requests: probes.length, transportPassed: probes.filter((entry) => entry.ok).length, semanticPassed: probes.filter((entry) => entry.semanticOk).length },
    concurrency4: { requests: concurrent.length, transportPassed: concurrent.filter((entry) => entry.ok).length, semanticPassed: concurrent.filter((entry) => entry.semanticOk).length },
    transportPassed: all.filter((entry) => entry.ok).length,
    semanticPassed: all.filter((entry) => entry.semanticOk).length,
    nonEmptyPassed: all.filter((entry) => entry.nonEmpty).length,
    errors,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length ? Math.max(...latencies) : null,
    },
  };
  result.responses = await responsesSmoke(apiKey, model);
  return result;
}

const apiKey = sqliteScalar("SELECT key FROM apiKeys WHERE isActive != 0 ORDER BY createdAt ASC LIMIT 1");
const escapedComboName = COMBO_NAME.replaceAll("'", "''");
const modelsJson = sqliteScalar(`SELECT models FROM combos WHERE name = '${escapedComboName}' LIMIT 1`);
if (!apiKey) throw new Error("No active local 9Router API key is configured");
if (!modelsJson) throw new Error(`Combo not found: ${COMBO_NAME}`);

const catalogResponse = await fetch(`${BASE_URL}/v1/models`, {
  headers: { authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
const catalog = catalogResponse.ok ? await catalogResponse.json() : null;
const listedModels = new Set((catalog?.data || []).map((entry) => entry?.id).filter(Boolean));
const requestedModels = process.argv.slice(3);
const comboModels = JSON.parse(modelsJson);
const models = requestedModels.length
  ? comboModels.filter((model) => requestedModels.includes(model))
  : comboModels;
if (requestedModels.length && models.length !== requestedModels.length) {
  throw new Error("One or more requested model IDs are not members of the combo");
}
const results = [];
let sequence = 1000;

for (const model of models) {
  const result = await stressRoute(apiKey, model, listedModels.has(model), sequence);
  sequence += 20;
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await new Promise((resolve) => setTimeout(resolve, 750));
}

const stressed = results.filter((entry) => entry.stress);
process.stdout.write(`${JSON.stringify({
  summary: {
    combo: COMBO_NAME,
    testedAt: new Date().toISOString(),
    routes: results.length,
    transportReachable: results.filter((entry) => entry.smoke.ok).length,
    stressed: stressed.length,
    fullyReliable: stressed.filter((entry) => entry.stress.transportPassed === entry.stress.requests && entry.stress.semanticPassed === entry.stress.requests).length,
    codexResponsesCompatible: results.filter((entry) => entry.responses?.ok).length,
  },
})}\n`);
