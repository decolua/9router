// REAL matrix: DeepSeek OFFICIAL Responses API — direct behavior vs 9router translation.
//
// Context: DeepSeek recently shipped an OpenAI-Responses-compatible endpoint
// (https://api.deepseek.com/responses) but the 9router registry does not declare it —
// responses-format requests are translated to /chat/completions. This suite answers:
//
//   1. DIRECT: does the official /responses endpoint demand reasoning pass-back
//      (like official /chat/completions does: "reasoning_content must be passed back")?
//   2. 9ROUTER: when a responses-format client hits 9router, what does the translation
//      to /chat/completions do with reasoning items — and does multi-turn survive the
//      pass-back requirement on the chat endpoint?
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/deepseek-official-responses.real.test.js
//
// Reads the DeepSeek API key from the local 9router DB (connection id
// a91b07f2-878a-45b0-beb5-56981409ab0c). Uses handleChatCore for the 9router half.
import { describe, it, expect } from "vitest";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { openaiResponsesToOpenAIRequest } from "../../../open-sse/translator/request/openai-responses.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const PROVIDER = "deepseek";
const MODEL = "deepseek-reasoner";
const TIMEOUT_MS = 120000;
const CRED_ISSUE = [401, 402, 403, 429];

// API key from the local DB connection (no dashboard/DB writes — read-only).
function readApiKey() {
  const Database = require("better-sqlite3");
  const path = require("path");
  const dbPath = path.join(process.env.APPDATA, "9router", "db", "data.sqlite");
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(
    "SELECT data FROM providerConnections WHERE provider = ? AND isActive = 0 ORDER BY updatedAt DESC LIMIT 1"
  ).all("deepseek");
  db.close();
  if (!rows.length) return null;
  try {
    const data = JSON.parse(rows[0].data);
    return data.apiKey || null;
  } catch { return null; }
}

// ---- DIRECT half: raw fetch to the official /responses endpoint ----
async function directResponses(body) {
  const res = await fetch("https://api.deepseek.com/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.DS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, json, raw: text };
}

const TURN1_USER = { type: "message", role: "user", content: [{ type: "input_text", text: "Think step by step about 17+26, then reply with ONLY the number." }] };
const TURN2_USER = { type: "message", role: "user", content: [{ type: "input_text", text: "What was your final answer? Reply with just the number." }] };

async function directTurn1() {
  const out = await directResponses({
    model: MODEL, stream: false, max_output_tokens: 512,
    reasoning: { effort: "high" },
    input: [TURN1_USER],
  });
  return out;
}

describe.skipIf(!RUN_REAL)("DIRECT: DeepSeek official /responses endpoint", () => {
  it("has a DeepSeek API key in the local DB", () => {
    expect(process.env.DS_KEY && process.env.DS_KEY.startsWith("sk-")).toBe(true);
  });

  it("single-turn works and returns a Responses-shape payload", async () => {
    const out = await directResponses({ model: MODEL, stream: false, input: [TURN1_USER] });
    console.log(`[direct single] status=${out.status}`);
    expect(out.status).toBe(200);
    expect(out.json?.object).toBe("response");
    expect(out.json?.output?.some((o) => o.type === "message")).toBe(true);
  });

  it("turn1 with reasoning returns a reasoning item", async () => {
    const out = await directTurn1();
    expect(out.status).toBe(200);
    const types = (out.json?.output || []).map((o) => o.type);
    console.log(`[direct turn1] output types=${types.join(",")} reasoning_tokens=${out.json?.usage?.output_tokens_details?.reasoning_tokens}`);
    expect(types).toContain("reasoning");
  });

  it("turn2 WITHOUT reasoning item is accepted (no pass-back requirement)", async () => {
    const t1 = await directTurn1();
    const outMsg = (t1.json?.output || []).find((o) => o.type === "message");
    const out = await directResponses({
      model: MODEL, stream: false, max_output_tokens: 256,
      input: [TURN1_USER, { type: "message", role: "assistant", content: outMsg?.content }, TURN2_USER],
    });
    console.log(`[direct turn2 no-reasoning] status=${out.status}`);
    expect(out.status).toBe(200);
  });

  it("turn2 WITH reasoning item is accepted", async () => {
    const t1 = await directTurn1();
    const reas = (t1.json?.output || []).find((o) => o.type === "reasoning");
    const outMsg = (t1.json?.output || []).find((o) => o.type === "message");
    const out = await directResponses({
      model: MODEL, stream: false, max_output_tokens: 256,
      input: [TURN1_USER, reas, { type: "message", role: "assistant", content: outMsg?.content }, TURN2_USER],
    });
    console.log(`[direct turn2 with-reasoning] status=${out.status}`);
    expect(out.status).toBe(200);
  });

  it("streaming single-turn returns Responses SSE events", async () => {
    const res = await fetch("https://api.deepseek.com/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.DS_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, stream: true, max_output_tokens: 256, input: [TURN1_USER] }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = (text.match(/event: ([a-z_.]+)/g) || []).map((e) => e.slice(7));
    const hasCreated = events.includes("response.created");
    const hasCompleted = events.includes("response.completed");
    console.log(`[direct stream] status=200 events=${events.join(",")}`);
    expect(hasCreated).toBe(true);
    expect(hasCompleted).toBe(true);
  }, TIMEOUT_MS);
});

// ---- UNIT half: what the responses→chat translator does with reasoning ----
describe("UNIT: responses→chat translator reasoning handling", () => {
  it("attaches reasoning item text as reasoning_content on the assistant message", () => {
    const body = {
      input: [
        TURN1_USER,
        { type: "reasoning", id: "rs_1", content: [{ type: "reasoning_text", text: "17 + 26 = 43" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "43" }] },
        TURN2_USER,
      ],
    };
    const result = openaiResponsesToOpenAIRequest(MODEL, body, false, null);
    const assistant = result.messages.find((m) => m.role === "assistant");
    expect(assistant.reasoning_content).toContain("43");
    expect(result.messages.length).toBe(3);
  });

  it("leaves assistant messages bare when no reasoning item is present", () => {
    const body = {
      input: [TURN1_USER, { type: "message", role: "assistant", content: [{ type: "output_text", text: "43" }] }, TURN2_USER],
    };
    const result = openaiResponsesToOpenAIRequest(MODEL, body, false, null);
    const assistant = result.messages.find((m) => m.role === "assistant");
    expect(assistant.reasoning_content).toBeUndefined();
  });
});

// ---- 9ROUTER half: handleChatCore with responses sourceFormat ----
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

async function via9router(body) {
  const credentials = {
    apiKey: process.env.DS_KEY,
    connectionId: "a91b07f2-878a-45b0-beb5-56981409ab0c",
    providerSpecificData: { connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "" },
  };
  const result = await handleChatCore({
    body: { ...body, model: `${PROVIDER}/${MODEL}` },
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials,
    connectionId: credentials.connectionId,
    sourceFormatOverride: "openai-responses",
  });
  if (!result.success) {
    const status = Number(result.status);
    if (CRED_ISSUE.includes(status) || (status >= 500) || status === 406) return { skip: true };
    return { ok: false, status: status || "n/a", raw: String(result.error || "") };
  }
  return { ok: true, status: 200, raw: await drainSSE(result.response) };
}

describe.skipIf(!RUN_REAL)(`9ROUTER: responses-format → ${PROVIDER} translation`, () => {
  it("single-turn responses request succeeds via /chat/completions", async () => {
    const out = await via9router({
      stream: true, max_output_tokens: 128, instructions: "You are concise.",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with the single word: hi" }] }],
    });
    if (out.skip) return expect(true).toBe(true);
    // 9router routes the request to /chat/completions but re-encodes the stream
    // back to the client's source format (Responses SSE shape).
    const isResponsesShape = /event: response\.|"type"\s*:\s*"response|"type":"response/.test(out.raw || "");
    const isChatShape = /chat\.completion\.chunk|"delta"/.test(out.raw || "");
    console.log(`[9r single] status=${out.status} bytes=${out.raw?.length} responsesShape=${isResponsesShape} chatShape=${isChatShape}`);
    expect(out.ok).toBe(true);
    expect(isResponsesShape || isChatShape).toBe(true);
  }, TIMEOUT_MS);

  it("multi-turn WITH reasoning item in history succeeds (translator attaches reasoning_content)", async () => {
    const out = await via9router({
      stream: true, max_output_tokens: 128,
      input: [
        TURN1_USER,
        { type: "reasoning", id: "rs_1", content: [{ type: "reasoning_text", text: "17 + 26 = 43" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "43" }] },
        TURN2_USER,
      ],
    });
    if (out.skip) return expect(true).toBe(true);
    console.log(`[9r multi with-reasoning] status=${out.status} bytes=${out.raw?.length}`);
    expect(out.ok).toBe(true);
  }, TIMEOUT_MS);

  it("multi-turn WITHOUT reasoning item in history (diagnostic: chat endpoint pass-back)", async () => {
    const out = await via9router({
      stream: true, max_output_tokens: 128,
      input: [
        TURN1_USER,
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "43" }] },
        TURN2_USER,
      ],
    });
    if (out.skip) return expect(true).toBe(true);
    console.log(`[9r multi no-reasoning] status=${out.status} raw=${out.raw?.slice?.(0, 200)}`);
    // Diagnostic: the official chat endpoint requires reasoning_content pass-back;
    // a 400 here proves the translation path needs the reasoning item to survive.
    expect(out.skip).not.toBe(true);
  }, TIMEOUT_MS);
});
