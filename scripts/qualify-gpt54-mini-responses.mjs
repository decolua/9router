#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH = process.env.NINE_ROUTER_DB || join(homedir(), ".9router", "db", "data.sqlite");
const BASE_URL = (process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
const COMBO_NAME = process.argv[2] || "gpt-5.4-mini";
const TIMEOUT_MS = Number(process.env.NINE_ROUTER_PROBE_TIMEOUT_MS || 45_000);

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

function classifyFailure(status, payload) {
  if (status === 401 || status === 403) return "authentication rejected";
  if (status === 404) return "route or model not found";
  if (status === 408 || status === 504) return "provider timeout";
  if (status === 429) return "rate limit or quota exhausted";
  return sanitize(
    payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      payload?.msg ||
      `HTTP ${status}`
  );
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("");
}

function shapeSummary(payload) {
  return {
    keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 20) : [],
    object: payload?.object || null,
    outputTypes: (payload?.output || []).map((item) => item?.type || null).slice(0, 10),
    contentTypes: (payload?.output || [])
      .flatMap((item) => item?.content || [])
      .map((content) => content?.type || null)
      .slice(0, 10),
    choices: Array.isArray(payload?.choices) ? payload.choices.length : 0,
    choiceHasToolCalls: Boolean(payload?.choices?.[0]?.message?.tool_calls?.length),
  };
}

async function request(apiKey, model, body) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}/v1/responses`, {
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
    } catch {}
    if (!response.ok || payload?.error) {
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

async function basicProbe(apiKey, model) {
  const result = await request(apiKey, model, {
    instructions: "Follow the exact output instruction.",
    max_output_tokens: 64,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Reply with exactly CODEX_OK and no other text." }],
      },
    ],
  });
  if (!result.ok) return result;
  const valid = outputText(result.payload).trim() === "CODEX_OK";
  return {
    ok: valid,
    transportOk: true,
    status: result.status,
    latencyMs: result.latencyMs,
    error: valid ? null : "Responses API output did not follow the exact-output instruction",
    shape: valid ? undefined : shapeSummary(result.payload),
  };
}

async function toolProbe(apiKey, model) {
  const result = await request(apiKey, model, {
    max_output_tokens: 128,
    tools: [
      {
        type: "function",
        name: "route_probe",
        description: "Records a route qualification value.",
        parameters: {
          type: "object",
          properties: { value: { type: "integer" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "function", name: "route_probe" },
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Call route_probe with value 7. Do not answer in plain text.",
          },
        ],
      },
    ],
  });
  if (!result.ok) return result;
  const call = (result.payload?.output || []).find((item) => item?.type === "function_call");
  let args = null;
  try {
    args = JSON.parse(call?.arguments || "");
  } catch {}
  const valid = call?.name === "route_probe" && args?.value === 7;
  return {
    ok: valid,
    transportOk: true,
    status: result.status,
    latencyMs: result.latencyMs,
    error: valid ? null : "Responses API did not return the required function call",
    shape: valid ? undefined : shapeSummary(result.payload),
  };
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
const results = [];

for (const model of models) {
  const basic = await basicProbe(apiKey, model);
  const tool =
    basic.ok || basic.transportOk
      ? await toolProbe(apiKey, model)
      : { ok: false, skipped: true, error: "skipped because Responses API transport failed" };
  const latencies = [basic.latencyMs, tool.latencyMs].filter(Number.isFinite);
  const entry = {
    model,
    passed: Number(basic.ok) + Number(tool.ok),
    attempted: [basic, tool].filter((probe) => !probe.skipped).length,
    averageLatencyMs: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null,
    probes: { basic, tool },
  };
  results.push(entry);
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

process.stdout.write(
  `${JSON.stringify({
    summary: {
      combo: COMBO_NAME,
      testedAt: new Date().toISOString(),
      routes: results.length,
      basicPassed: results.filter((entry) => entry.probes.basic.ok).length,
      fullyPassed: results.filter((entry) => entry.passed === 2).length,
    },
  })}\n`
);
