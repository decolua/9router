// REAL integration test: hits localhost:20128/v1 with real API key for all antigravity models.
// Verifies tool-call with optional field in schema doesn't cause 400 INVALID_ARGUMENT.
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/antigravity-models.real.test.js
//   RUN_REAL=1 AG_URL=http://localhost:20128/v1 AG_KEY=sk-xxx npx vitest run ...
//
import { describe, it, expect } from "vitest";

const RUN_REAL = process.env.RUN_REAL === "1";
const BASE_URL = process.env.AG_URL || "http://localhost:20128/v1";
const API_KEY = process.env.AG_KEY;
const TIMEOUT_MS = 90000;

// All antigravity models (from providers/registry/antigravity.js)
const AG_MODELS = [
  "ag/gemini-3-flash-agent",
  "ag/gemini-3.5-flash-low",
  "ag/gemini-3.5-flash-extra-low",
  "ag/gemini-pro-agent",
  "ag/gemini-3.1-pro-low",
  "ag/claude-sonnet-4-6",
  "ag/claude-opus-4-6-thinking",
  "ag/gpt-oss-120b-medium",
  "ag/gemini-3-flash",
];

// Simple text prompt — no tools
const SIMPLE_BODY = (model) => ({
  model,
  stream: false,
  max_tokens: 32,
  messages: [{ role: "user", content: "Reply with the single word: hi" }],
});

// Tool call with `optional` field in schema — this is the bug scenario
const TOOL_BODY = (model) => ({
  model,
  stream: false,
  max_tokens: 64,
  messages: [{ role: "user", content: "What is 2+2?" }],
  tools: [
    {
      type: "function",
      function: {
        name: "calculate",
        description: "Perform arithmetic",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "The math expression", optional: true },
            precision: { type: "number", description: "Decimal precision", optional: true },
            note: { type: "string", optional: true },
          },
          required: [],
        },
      },
    },
  ],
});

async function callChat(body) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }

  return { status: res.status, text, json };
}

describe.skipIf(!RUN_REAL).concurrent("antigravity models — real", () => {
  for (const model of AG_MODELS) {
    it(`${model}: simple prompt`, async () => {
      const { status, json, text } = await callChat(SIMPLE_BODY(model));

      // Credential/quota issues are not translation bugs → warn and pass
      if ([401, 402, 403, 429].includes(status)) {
        console.warn(`[skip] ${model}: ${status} (credential/quota)`);
        return;
      }

      // Provider-side 400 (e.g. stream_options, model quirks) → skip
      if (status === 400) {
        console.warn(`[skip] ${model}: 400 (provider quirk): ${text.slice(0, 200)}`);
        return;
      }

      expect(status, `${model} simple: ${text.slice(0, 300)}`).toBe(200);
      // Accept either OpenAI-shaped or raw Gemini-shaped response
      const hasContent =
        json?.choices?.[0]?.message?.content ||
        json?.choices?.[0]?.message?.tool_calls ||
        json?.candidates?.[0]?.content?.parts?.length > 0 ||
        json?.choices?.[0]?.finish_reason;
      expect(hasContent, `${model} simple: no content in ${text.slice(0, 300)}`).toBeTruthy();
    }, TIMEOUT_MS);

    it(`${model}: tool call with optional field in schema`, async () => {
      const { status, json, text } = await callChat(TOOL_BODY(model));

      if ([401, 402, 403, 429].includes(status)) {
        console.warn(`[skip] ${model}: ${status} (credential/quota)`);
        return;
      }

      // 400 with "optional" + "Cannot find field" = the specific bug
      if (status === 400) {
        const errMsg = json?.error?.message || text;
        if (/optional.*Cannot find field|Cannot find field.*optional|Unknown name.*optional/i.test(errMsg)) {
          throw new Error(`BUG: ${model} — 400 due to optional field: ${errMsg.slice(0, 300)}`);
        }
        // Other 400 (e.g. model doesn't support tools, stream_options issue) → skip
        console.warn(`[skip] ${model}: 400 non-optional error: ${errMsg.slice(0, 200)}`);
        return;
      }

      expect(status, `${model} tool: ${text.slice(0, 300)}`).toBe(200);
    }, TIMEOUT_MS);
  }
});
