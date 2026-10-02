#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const MODEL = process.argv[2] || "groq/openai/gpt-oss-120b";
const DB_PATH = process.env.NINE_ROUTER_DB || join(homedir(), ".9router", "db", "data.sqlite");
const BASE_URL = (process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.NINE_ROUTER_PROBE_TIMEOUT_MS || 30_000);
const STAGES = [
  { concurrency: 1, requests: 8 },
  { concurrency: 2, requests: 8 },
  { concurrency: 4, requests: 12 },
  { concurrency: 8, requests: 16 },
];

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
    .slice(0, 180);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function extractChatText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").join("");
  }
  return "";
}

function classify(status, payload) {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "provider_or_router_5xx";
  const message = payload?.error?.message || payload?.error || payload?.message || payload?.msg;
  return message ? sanitize(message) : `http_${status}`;
}

async function post(apiKey, path, body) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - started);
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {}
    if (!response.ok || payload?.error) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        category: classify(response.status, payload),
        retryAfter: response.headers.get("retry-after") || null,
      };
    }
    return {
      ok: true,
      status: response.status,
      latencyMs,
      payload,
      retryAfter: response.headers.get("retry-after") || null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Math.round(performance.now() - started),
      category: error?.name === "TimeoutError" ? "timeout" : sanitize(error?.message),
      retryAfter: null,
    };
  }
}

async function chatBasic(apiKey, sequence) {
  const result = await post(apiKey, "/v1/chat/completions", {
    model: MODEL,
    stream: false,
    temperature: 0,
    max_tokens: 128,
    messages: [{ role: "user", content: `Reply with exactly OK${sequence}.` }],
  });
  if (!result.ok) return result;
  const text = extractChatText(result.payload).trim();
  return {
    ok: true,
    semanticOk: text === `OK${sequence}`,
    nonEmpty: text.length > 0,
    status: result.status,
    latencyMs: result.latencyMs,
    retryAfter: result.retryAfter,
  };
}

async function structuredProbe(apiKey) {
  const result = await post(apiKey, "/v1/chat/completions", {
    model: MODEL,
    stream: false,
    temperature: 0,
    max_tokens: 256,
    messages: [{ role: "user", content: 'Return {"ok":true,"value":7}.' }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "stress_probe",
        strict: true,
        schema: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            value: { type: "integer" },
          },
          required: ["ok", "value"],
          additionalProperties: false,
        },
      },
    },
  });
  if (!result.ok) return result;
  let parsed = null;
  try {
    parsed = JSON.parse(extractChatText(result.payload));
  } catch {}
  return {
    ok: parsed?.ok === true && parsed?.value === 7,
    status: result.status,
    latencyMs: result.latencyMs,
    category: parsed ? null : "invalid_json",
  };
}

async function toolProbe(apiKey) {
  const result = await post(apiKey, "/v1/chat/completions", {
    model: MODEL,
    stream: false,
    temperature: 0,
    max_tokens: 256,
    messages: [{ role: "user", content: "Call stress_probe with value 7." }],
    tools: [
      {
        type: "function",
        function: {
          name: "stress_probe",
          description: "Records a stress-test value.",
          parameters: {
            type: "object",
            properties: { value: { type: "integer" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "stress_probe" } },
  });
  if (!result.ok) return result;
  const call = result.payload?.choices?.[0]?.message?.tool_calls?.[0];
  let args = null;
  try {
    args = JSON.parse(call?.function?.arguments || "");
  } catch {}
  return {
    ok: call?.function?.name === "stress_probe" && args?.value === 7,
    status: result.status,
    latencyMs: result.latencyMs,
    category: call ? null : "missing_tool_call",
  };
}

async function responsesProbe(apiKey) {
  const result = await post(apiKey, "/v1/responses", {
    model: MODEL,
    stream: false,
    max_output_tokens: 64,
    instructions: "Follow the exact output instruction.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Reply with exactly CODEX_OK." }],
      },
    ],
  });
  if (!result.ok) return result;
  return {
    ok: result.payload?.object === "response" && Array.isArray(result.payload?.output),
    status: result.status,
    latencyMs: result.latencyMs,
    object: result.payload?.object || null,
    hasOutput: Array.isArray(result.payload?.output),
    hasChoices: Array.isArray(result.payload?.choices),
  };
}

async function runStage(apiKey, stage, sequenceStart) {
  const results = new Array(stage.requests);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= stage.requests) return;
      results[index] = await chatBasic(apiKey, sequenceStart + index);
    }
  }

  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(stage.concurrency, stage.requests) }, () => worker())
  );
  const wallMs = Math.round(performance.now() - started);
  const latencies = results.map((result) => result.latencyMs).filter(Number.isFinite);
  const categories = {};
  for (const result of results) {
    if (!result.ok) categories[result.category || "unknown"] = (categories[result.category || "unknown"] || 0) + 1;
  }

  return {
    concurrency: stage.concurrency,
    requests: stage.requests,
    transportPassed: results.filter((result) => result.ok).length,
    semanticPassed: results.filter((result) => result.semanticOk).length,
    nonEmptyPassed: results.filter((result) => result.nonEmpty).length,
    errors: categories,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : null,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length ? Math.max(...latencies) : null,
    },
    throughputRps: wallMs ? Number((stage.requests / (wallMs / 1000)).toFixed(2)) : null,
    wallMs,
  };
}

const apiKey = sqliteScalar(
  "SELECT key FROM apiKeys WHERE isActive != 0 ORDER BY createdAt ASC LIMIT 1"
);
if (!apiKey) throw new Error("No active local 9Router API key is configured");

const modelsResponse = await fetch(`${BASE_URL}/v1/models`, {
  headers: { authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
const modelsPayload = modelsResponse.ok ? await modelsResponse.json() : null;
const listed = Boolean((modelsPayload?.data || []).some((entry) => entry?.id === MODEL));
process.stdout.write(`${JSON.stringify({ inventory: { model: MODEL, listed } })}\n`);

const warmup = {
  warmup1: await chatBasic(apiKey, 9001),
  warmup2: await chatBasic(apiKey, 9002),
};
process.stdout.write(`${JSON.stringify({ warmup })}\n`);

const stages = [];
let sequence = 1;
for (const stage of STAGES) {
  const result = await runStage(apiKey, stage, sequence);
  stages.push(result);
  sequence += stage.requests;
  process.stdout.write(`${JSON.stringify({ stage: result })}\n`);
}

await new Promise((resolve) => setTimeout(resolve, 3_000));
const compatibility = {
  structured: await structuredProbe(apiKey),
  tool: await toolProbe(apiKey),
  responses: await responsesProbe(apiKey),
};
process.stdout.write(`${JSON.stringify({ compatibility })}\n`);

await new Promise((resolve) => setTimeout(resolve, 3_000));
const cooldown = await chatBasic(apiKey, 9999);
process.stdout.write(`${JSON.stringify({ cooldown })}\n`);

const totalRequests = stages.reduce((sum, stage) => sum + stage.requests, 0);
const transportPassed = stages.reduce((sum, stage) => sum + stage.transportPassed, 0);
const semanticPassed = stages.reduce((sum, stage) => sum + stage.semanticPassed, 0);
process.stdout.write(
  `${JSON.stringify({
    summary: {
      model: MODEL,
      testedAt: new Date().toISOString(),
      loadRequests: totalRequests,
      transportPassed,
      semanticPassed,
      transportSuccessPct: Number(((transportPassed / totalRequests) * 100).toFixed(1)),
      semanticSuccessPct: Number(((semanticPassed / totalRequests) * 100).toFixed(1)),
    },
  })}\n`
);
