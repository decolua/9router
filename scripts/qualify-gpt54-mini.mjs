#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = process.env.NINE_ROUTER_DB || join(homedir(), ".9router", "db", "data.sqlite");
const BASE_URL = (process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
const COMBO_NAME = process.argv[2] || "gpt-5.4-mini";
const TIMEOUT_MS = Number(process.env.NINE_ROUTER_PROBE_TIMEOUT_MS || 45_000);

function sanitize(value) {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk[-_][A-Za-z0-9._-]+/g, "[redacted-key]")
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").join("");
  }
  return "";
}

function classifyFailure(status, payload) {
  if (status === 401 || status === 403) return "authentication rejected";
  if (status === 404) return "route or model not found";
  if (status === 408 || status === 504) return "provider timeout";
  if (status === 429) return "rate limit or quota exhausted";
  const message =
    payload?.error?.message ||
    payload?.error ||
    payload?.message ||
    payload?.msg ||
    `HTTP ${status}`;
  return sanitize(message);
}

async function request(apiKey, model, body) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, stream: false, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - started);
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        error: classifyFailure(response.status, payload),
      };
    }
    if (payload?.error) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        error: classifyFailure(response.status, payload),
      };
    }
    return { ok: true, status: response.status, latencyMs, payload };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Math.round(performance.now() - started),
      error: error?.name === "TimeoutError" ? "probe timeout" : sanitize(error?.message),
    };
  }
}

async function probeBasic(apiKey, model) {
  const result = await request(apiKey, model, {
    max_tokens: 32,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: "Reply with exactly ROUTE_OK and no other text.",
      },
    ],
  });
  if (!result.ok) return result;
  const content = extractContent(result.payload).trim();
  return {
    ok: content === "ROUTE_OK",
    transportOk: true,
    status: result.status,
    latencyMs: result.latencyMs,
    error: content === "ROUTE_OK" ? null : "completion did not follow the exact-output instruction",
  };
}

async function probeStructured(apiKey, model) {
  const result = await request(apiKey, model, {
    max_tokens: 96,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: 'Return the object {"ok":true,"value":7}.',
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "route_probe",
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
  try {
    const parsed = JSON.parse(extractContent(result.payload));
    const valid = parsed?.ok === true && parsed?.value === 7;
    return {
      ok: valid,
      status: result.status,
      latencyMs: result.latencyMs,
      error: valid ? null : "response JSON did not match the requested schema values",
    };
  } catch {
    return {
      ok: false,
      status: result.status,
      latencyMs: result.latencyMs,
      error: "response content was not valid JSON",
    };
  }
}

async function probeTool(apiKey, model) {
  const result = await request(apiKey, model, {
    max_tokens: 128,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: "Call route_probe with value 7. Do not answer in plain text.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "route_probe",
          description: "Records a route qualification value.",
          parameters: {
            type: "object",
            properties: { value: { type: "integer" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: "route_probe" },
    },
  });
  if (!result.ok) return result;
  const toolCall = result.payload?.choices?.[0]?.message?.tool_calls?.[0];
  let args = null;
  try {
    args = JSON.parse(toolCall?.function?.arguments || "");
  } catch {}
  const valid = toolCall?.function?.name === "route_probe" && args?.value === 7;
  return {
    ok: valid,
    status: result.status,
    latencyMs: result.latencyMs,
    error: valid ? null : "provider did not return the required function call",
  };
}

async function fetchListedModels(apiKey) {
  try {
    const response = await fetch(`${BASE_URL}/v1/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return new Set((payload?.data || []).map((entry) => entry?.id).filter(Boolean));
  } catch {
    return null;
  }
}

function sqliteScalar(sql) {
  return execFileSync("sqlite3", ["-noheader", DB_PATH, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const apiKey = sqliteScalar(
  "SELECT key FROM apiKeys WHERE isActive != 0 ORDER BY createdAt ASC LIMIT 1"
);
const escapedComboName = COMBO_NAME.replaceAll("'", "''");
const comboModels = sqliteScalar(
  `SELECT models FROM combos WHERE name = '${escapedComboName}' LIMIT 1`
);

if (!apiKey) throw new Error("No active local 9Router API key is configured");
if (!comboModels) throw new Error(`Combo not found: ${COMBO_NAME}`);

const requestedModels = process.argv.slice(3);
const comboModelList = JSON.parse(comboModels);
const models = requestedModels.length
  ? comboModelList.filter((model) => requestedModels.includes(model))
  : comboModelList;
if (requestedModels.length && models.length !== requestedModels.length) {
  throw new Error("One or more requested model IDs are not members of the combo");
}
const listedModels = await fetchListedModels(apiKey);
const results = [];

for (const model of models) {
  const basic = await probeBasic(apiKey, model);
  let structured = { ok: false, skipped: true, error: "skipped because basic completion failed" };
  let tool = { ok: false, skipped: true, error: "skipped because basic completion failed" };

  if (basic.ok || basic.transportOk) {
    structured = await probeStructured(apiKey, model);
    tool = await probeTool(apiKey, model);
  }

  const passed = [basic, structured, tool].filter((probe) => probe.ok).length;
  const attemptedLatencies = [basic, structured, tool]
    .map((probe) => probe.latencyMs)
    .filter(Number.isFinite);

  const entry = {
    model,
    listed: listedModels ? listedModels.has(model) : null,
    passed,
    attempted: [basic, structured, tool].filter((probe) => !probe.skipped).length,
    averageLatencyMs: attemptedLatencies.length
      ? Math.round(attemptedLatencies.reduce((sum, value) => sum + value, 0) / attemptedLatencies.length)
      : null,
    probes: { basic, structured, tool },
  };
  results.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

const summary = {
  combo: COMBO_NAME,
  testedAt: new Date().toISOString(),
  routes: results.length,
  basicPassed: results.filter((entry) => entry.probes.basic.ok).length,
  fullyPassed: results.filter((entry) => entry.passed === 3).length,
};
process.stdout.write(`${JSON.stringify({ summary })}\n`);
