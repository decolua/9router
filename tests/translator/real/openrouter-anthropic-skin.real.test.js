// REAL integration test: routes a claude-format request through the full
// production path (handleChatCore) to OpenRouter's Anthropic-compatible
// /v1/messages endpoint (sourceFormat-matched transport, zero translation),
// using a non-Anthropic model to exercise OpenRouter's server-side conversion.
//
//   RUN_REAL=1 OPENROUTER_API_KEY=sk-or-... npx vitest run translator/real/openrouter-anthropic-skin.real.test.js
import { describe, it, expect } from "vitest";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const API_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = process.env.OPENROUTER_REAL_MODEL || "z-ai/glm-5.3-flash";
const TIMEOUT_MS = 120000;

function claudeToolBody(stream) {
  return {
    model: `openrouter/${MODEL}`,
    stream,
    max_tokens: 16000,
    thinking: { type: "enabled", budget_tokens: 4096 },
    system: [{ type: "text", text: "Use the get_weather tool for every city the user mentions. Call it once per city, in parallel, in a single turn." }],
    messages: [{ role: "user", content: [{ type: "text", text: "What's the weather in Paris, Tokyo and Berlin right now?" }] }],
    tools: [{
      name: "get_weather",
      description: "Get current weather for a city",
      input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    }],
  };
}

// Parse a raw Claude SSE stream into events.
function parseClaudeSSE(raw) {
  return raw.split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter((d) => d && d !== "[DONE]")
    .map((d) => { try { return JSON.parse(d); } catch { return null; } })
    .filter(Boolean);
}

async function drainSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe.skipIf(!RUN_REAL || !API_KEY)("REAL openrouter /v1/messages (anthropic skin)", () => {
  it("streams claude-format tool_use blocks with unique ids and valid input JSON", async () => {
    const result = await handleChatCore({
      body: claudeToolBody(true),
      modelInfo: { provider: "openrouter", model: MODEL },
      credentials: { apiKey: API_KEY },
    });

    expect(result.success, `chatCore failed: ${result.status} ${result.error}`).toBe(true);

    const raw = await drainSSE(result.response);
    const events = parseClaudeSSE(raw);
    expect(events.length, "no claude SSE events — did the request hit /v1/messages?").toBeGreaterThan(0);
    expect(events.some((e) => e.type === "message_start"), "missing message_start (claude framing)").toBe(true);

    const toolStarts = events.filter((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(toolStarts.length, `raw head: ${raw.slice(0, 400)}`).toBeGreaterThan(0);

    const ids = toolStarts.map((e) => e.content_block.id);
    expect(new Set(ids).size, `duplicated tool_use ids: ${ids}`).toBe(ids.length);

    // Accumulate input_json_delta per block index and require valid JSON per tool
    const argsByIndex = new Map();
    for (const e of events) {
      if (e.type === "content_block_delta" && e.delta?.type === "input_json_delta") {
        argsByIndex.set(e.index, (argsByIndex.get(e.index) || "") + e.delta.partial_json);
      }
    }
    for (const t of toolStarts) {
      const buffered = argsByIndex.get(t.index) || "";
      const input = buffered ? JSON.parse(buffered) : t.content_block.input;
      expect(typeof input.city, `tool input missing city: ${JSON.stringify(input)}`).toBe("string");
    }

    const stops = events.filter((e) => e.type === "content_block_stop").map((e) => e.index);
    for (const t of toolStarts) expect(stops).toContain(t.index);
    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);

    console.log(`[real] ${MODEL} via /v1/messages: ${toolStarts.length} tool_use, thinking=${events.some((e) => e.content_block?.type === "thinking")}`);
  }, TIMEOUT_MS);

  it("non-streaming returns a claude message JSON with tool_use content", async () => {
    const result = await handleChatCore({
      body: claudeToolBody(false),
      modelInfo: { provider: "openrouter", model: MODEL },
      credentials: { apiKey: API_KEY },
    });

    expect(result.success, `chatCore failed: ${result.status} ${result.error}`).toBe(true);
    const json = await result.response.json();

    expect(json.type, `unexpected body: ${JSON.stringify(json).slice(0, 300)}`).toBe("message");
    expect(Array.isArray(json.content)).toBe(true);
    const toolUses = json.content.filter((b) => b.type === "tool_use");
    expect(toolUses.length).toBeGreaterThan(0);
    const ids = toolUses.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of toolUses) expect(typeof b.input?.city).toBe("string");
  }, TIMEOUT_MS);
});
