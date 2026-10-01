// REAL: full tool-use conversation sessions + thinking semantics + non-streaming
// paths for opencode-go DeepSeek.
//
// Covers the blind spots of the basic endpoint matrix (which only used plain-text
// bodies): the real 2-turn tool loop that #3332 originally reported 400 for,
// whether the `(max)` thinking suffix actually produces thinking output, the
// non-streaming code paths, and the chat-only-model fallback route.
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/opencode-go-tool-session.real.test.js
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const PROVIDER = "opencode-go";
const TIMEOUT_MS = 120000;
const CRED_ISSUE = [401, 402, 403, 429];
const SKIP_MSG_RE = /image|multimodal|vision|modality|unsupported|not support|reasoning_effort|deprecated|temperature|subscription|valid.*plan|embedding|quota|insufficient|model not found|context length|organization policy|disallowed|allowedmodels|failed_precondition/i;

const WEATHER_TOOL = { name: "get_weather", description: "Get weather for a city", input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } };
const TIME_TOOL = { name: "get_time", description: "Get current time in a city", input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } };

async function drainSSE(response) {
  if (!response?.body) return "";
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

async function prepare(model) {
  const creds = await getProviderCredentials(PROVIDER, new Set(), model);
  if (!creds || creds.allRateLimited) return null;
  return checkAndRefreshToken(PROVIDER, creds);
}

async function runChat(body, creds, model) {
  const result = await handleChatCore({
    body: { ...body, model: `${PROVIDER}/${model}` },
    modelInfo: { provider: PROVIDER, model },
    credentials: creds,
    connectionId: creds.connectionId,
    sourceFormatOverride: "claude",
  });
  if (!result.success) {
    const status = Number(result.status);
    if (CRED_ISSUE.includes(status) || (status >= 500) || status === 406) return { skip: true };
    if (status === 400 && SKIP_MSG_RE.test(String(result.error || ""))) return { skip: true };
    return { ok: false, status: status || "n/a", raw: String(result.error || "") };
  }
  return { ok: true, status: 200, raw: await drainSSE(result.response) };
}

// Parse Claude-shape SSE blocks: [{type:"tool_use",id,name,input}, ...]
function extractToolUses(raw) {
  const blocks = [];
  for (const chunk of raw.split("\n\n")) {
    const line = chunk.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      const d = JSON.parse(line.slice(6));
      if (d.type === "content_block_start" && d.content_block?.type === "tool_use") {
        blocks.push({ id: d.content_block.id, name: d.content_block.name, input: d.content_block.input });
      }
    } catch { /* skip malformed */ }
  }
  return blocks;
}

const THINKING_BODY = {
  stream: true,
  max_tokens: 1024,
  thinking: { type: "enabled", budget_tokens: 1024 },
};

describe.skipIf(!RUN_REAL)(`REAL tool sessions + semantics (${PROVIDER})`, () => {
  it("has an active opencode-go credential", async () => {
    const creds = await getProviderCredentials(PROVIDER, new Set(), "deepseek-v4-flash");
    expect(creds && !creds.allRateLimited).toBe(true);
  });

  it("2-turn tool loop via /messages with thinking enabled (the original 400 shape)", async () => {
    const model = "deepseek-v4-flash";
    const creds = await prepare(model);
    if (!creds) return expect(true).toBe(true);

    // Turn 1: real model turn that should call the tool.
    const t1 = await runChat({
      ...THINKING_BODY,
      tools: [WEATHER_TOOL],
      messages: [{ role: "user", content: "Weather in Paris? Call the get_weather tool and then stop." }],
    }, creds, model);
    if (!t1.ok) { console.warn(`[skip] turn1 failed ${t1.status}: ${t1.raw}`); return expect(true).toBe(true); }
    const toolUses = extractToolUses(t1.raw);
    console.log(`[loop turn1] status=200 tool_uses=${toolUses.length} ${toolUses.map((t) => t.name).join(",")}`);
    if (toolUses.length === 0) { console.warn("[skip] model did not call a tool on turn1"); return expect(true).toBe(true); }

    // Turn 2: replay the assistant tool_use (no thinking block — client-side real
    // history may or may not carry it; gateway reasoning_content covers pass-back)
    // and return the tool result. This is the exact conversation shape that 400'd
    // before (and which the endpoint matrix never exercised).
    const t2 = await runChat({
      ...THINKING_BODY,
      tools: [WEATHER_TOOL],
      messages: [
        { role: "user", content: "Weather in Paris? Call the get_weather tool and then stop." },
        { role: "assistant", content: toolUses.map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: t.input })) },
        { role: "user", content: [
          ...toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: '{"temp":"20C"}' })),
          { type: "text", text: "Summarize in one short sentence." },
        ] },
      ],
    }, creds, model);
    console.log(`[loop turn2] status=${t2.status} bytes=${t2.raw?.length}`);
    expect(t2.skip).not.toBe(true);
    expect(t2.ok).toBe(true);
  }, TIMEOUT_MS);

  it("parallel tool_use turn replayed with all results (thinking enabled)", async () => {
    const model = "deepseek-v4-flash";
    const creds = await prepare(model);
    if (!creds) return expect(true).toBe(true);

    const t1 = await runChat({
      ...THINKING_BODY,
      tools: [WEATHER_TOOL, TIME_TOOL],
      messages: [{ role: "user", content: "Call get_weather for Paris and get_time for Tokyo, both in parallel, then stop." }],
    }, creds, model);
    if (!t1.ok) { console.warn(`[skip] turn1 failed ${t1.status}: ${t1.raw}`); return expect(true).toBe(true); }
    const toolUses = extractToolUses(t1.raw);
    console.log(`[parallel turn1] tool_uses=${toolUses.length} ${toolUses.map((t) => t.name).join(",")}`);
    if (toolUses.length === 0) { console.warn("[skip] model did not call tools on turn1"); return expect(true).toBe(true); }

    const t2 = await runChat({
      ...THINKING_BODY,
      tools: [WEATHER_TOOL, TIME_TOOL],
      messages: [
        { role: "user", content: "Call get_weather for Paris and get_time for Tokyo, both in parallel, then stop." },
        { role: "assistant", content: toolUses.map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: t.input })) },
        { role: "user", content: [
          ...toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: t.name === "get_weather" ? '{"temp":"20C"}' : '{"time":"14:30"}' })),
          { type: "text", text: "Summarize in one short sentence." },
        ] },
      ],
    }, creds, model);
    console.log(`[parallel turn2] status=${t2.status} bytes=${t2.raw?.length}`);
    expect(t2.skip).not.toBe(true);
    expect(t2.ok).toBe(true);
  }, TIMEOUT_MS);

  for (const model of ["deepseek-v4-flash(max)", "deepseek-v4-pro(max)"]) {
    it(`(max) suffix on ${model} produces thinking output on /messages`, async () => {
      const creds = await prepare(model);
      if (!creds) return expect(true).toBe(true);
      const out = await runChat({
        stream: true,
        max_tokens: 1024,
        messages: [{ role: "user", content: "Think step by step about 17 + 26, then reply with ONLY the number." }],
      }, creds, model);
      if (out.skip) return expect(true).toBe(true);
      const hasThinkingDelta = /thinking_delta/.test(out.raw || "");
      const hasText = /content_block_delta.*text/.test(out.raw || "") || /"text":"/.test(out.raw || "");
      console.log(`[${model}] status=${out.status} thinking_delta=${hasThinkingDelta} text=${hasText} bytes=${out.raw?.length}`);
      expect(out.ok).toBe(true);
      expect(hasThinkingDelta, `(max) should enable thinking on ${model}`).toBe(true);
    }, TIMEOUT_MS);
  }

  it("non-streaming claude-format request (JSON path) succeeds", async () => {
    const model = "deepseek-v4-flash";
    const creds = await prepare(model);
    if (!creds) return expect(true).toBe(true);
    const out = await runChat({
      stream: false,
      max_tokens: 128,
      messages: [{ role: "user", content: "Reply with the single word: hi" }],
    }, creds, model);
    if (out.skip) return expect(true).toBe(true);
    const isJson = out.raw?.trim()?.startsWith("{");
    const hasText = /"text"/.test(out.raw || "");
    console.log(`[nonstream claude] status=${out.status} json=${isJson} hasText=${hasText} raw=${out.raw?.slice?.(0, 120)}`);
    expect(out.ok).toBe(true);
    expect(isJson).toBe(true);
  }, TIMEOUT_MS);

  it("non-streaming openai-responses-format request succeeds", async () => {
    const model = "deepseek-v4-flash";
    const creds = await prepare(model);
    if (!creds) return expect(true).toBe(true);
    const result = await handleChatCore({
      body: {
        model: `${PROVIDER}/${model}`, stream: false, max_output_tokens: 128,
        instructions: "You are concise.",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with the single word: hi" }] }],
      },
      modelInfo: { provider: PROVIDER, model },
      credentials: creds,
      connectionId: creds.connectionId,
      sourceFormatOverride: "openai-responses",
    });
    if (!result.success) {
      const status = Number(result.status);
      if (CRED_ISSUE.includes(status) || status >= 500 || status === 406) return expect(true).toBe(true);
      throw new Error(`[nonstream responses] ${status}: ${result.error}`);
    }
    const raw = await drainSSE(result.response);
    const isJson = raw?.trim()?.startsWith("{");
    const hasResponsesShape = /"output"|"object":"response"/.test(raw || "");
    console.log(`[nonstream responses] status=200 json=${isJson} responsesShape=${hasResponsesShape} raw=${raw?.slice?.(0, 150)}`);
    expect(isJson).toBe(true);
    expect(hasResponsesShape).toBe(true);
  }, TIMEOUT_MS);

  it("chat-only glm-5.2(max) falls back to /chat/completions for a claude-format client", async () => {
    const model = "glm-5.2(max)";
    const creds = await prepare("glm-5.2");
    if (!creds) return expect(true).toBe(true);
    const out = await runChat({
      stream: true,
      max_tokens: 128,
      messages: [{ role: "user", content: "Reply with the single word: hi" }],
    }, creds, model);
    if (out.skip) { console.warn("[skip] glm-5.2 rejected/absent upstream"); return expect(true).toBe(true); }
    // Guard blocks /messages; the request is translated to chat and lands on
    // /chat/completions, re-encoded to the client's claude format.
    const hasClaudeShape = /event:\s*\w|"type"\s*:\s*"(message_start|content_block_delta|message_stop)"/.test(out.raw || "");
    console.log(`[glm fallback] status=${out.status} claudeShape=${hasClaudeShape} bytes=${out.raw?.length}`);
    expect(out.ok).toBe(true);
    expect(hasClaudeShape).toBe(true);
  }, TIMEOUT_MS);
});
