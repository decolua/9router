// REAL multi-turn thinking pass-back matrix for opencode-go DeepSeek.
//
// Question under test: does the /responses endpoint have the same "cc problem"
// as /messages — i.e. DeepSeek rejects a follow-up turn whose assistant history
// lacks reasoning content, because 9router does not inject a placeholder on that
// path (injectReasoningContent only rewrites body.messages, not the responses
// `input` array)?
//
// Method: turn 1 asks a thinking question non-streamed (so the upstream's own
// output JSON is easy to inspect), then turn 2 replays the assistant turn
// (reasoning + output) in the exact shape the client would, and records whether
// the upstream accepts it.
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/opencode-go-thinking-passthrough.real.test.js
//
// Cells:
//   - openai-responses: assistant turn WITHOUT reasoning item (plain client replay)
//   - openai-responses: assistant turn WITH reasoning item (Codex-style store=false replay)
//   - openai: control — known-good (injectReasoningContent covers chat path)
//   - claude: control — known-broken (handlesThinkingBlocks excludes opencode-go)
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const PROVIDER = "opencode-go";
const MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 120000;
const CRED_ISSUE = [401, 402, 403, 429];
const SKIP_MSG_RE = /image|multimodal|vision|modality|unsupported|not support|reasoning_effort|deprecated|temperature|subscription|valid.*plan|embedding|quota|insufficient|model not found|context length|organization policy|disallowed|allowedmodels|failed_precondition/i;

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

async function credentials() {
  const creds = await getProviderCredentials(PROVIDER, new Set(), MODEL);
  if (!creds || creds.allRateLimited) return null;
  return checkAndRefreshToken(PROVIDER, creds);
}

// Fire one request; returns { ok, status, raw } — never throws on upstream 4xx.
async function send(body, sourceFormat, creds) {
  const result = await handleChatCore({
    body: { ...body, model: `${PROVIDER}/${MODEL}` },
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: creds,
    connectionId: creds.connectionId,
    sourceFormatOverride: sourceFormat,
  });
  if (!result.success) {
    const status = Number(result.status);
    if (CRED_ISSUE.includes(status) || (status >= 500) || status === 406) return { skip: true };
    if (status === 400 && SKIP_MSG_RE.test(String(result.error || ""))) return { skip: true };
    return { ok: false, status: status || "n/a", raw: String(result.error || "") };
  }
  return { ok: true, status: 200, raw: await drainSSE(result.response) };
}

// Non-stream responses-format turn 1 — returns the full JSON response object.
async function responsesTurn1(creds, retries = 2) {
  const body = {
    stream: false,
    max_output_tokens: 1024,
    reasoning: { effort: "high" },
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Think step by step about 17 + 26, then reply with ONLY the number." }] }],
  };
  for (let i = 0; i <= retries; i++) {
    const out = await send(body, "openai-responses", creds);
    if (out.ok) {
      try { return { ok: true, json: JSON.parse(out.raw) }; } catch { return { ok: true, json: null, raw: out.raw }; }
    }
    if (!out.skip && out.status) return out; // real upstream rejection, don't retry
    if (i < retries) await new Promise((r) => setTimeout(r, 2000)); // transient 429 → back off
  }
  return { ok: false, skip: true };
}

describe.skipIf(!RUN_REAL)(`REAL opencode-go thinking pass-back (${PROVIDER}/${MODEL})`, () => {
  it("has an active opencode-go credential", async () => {
    const creds = await getProviderCredentials(PROVIDER, new Set(), MODEL);
    expect(creds && !creds.allRateLimited).toBe(true);
  });

  it("openai-responses: follow-up with NO reasoning item in assistant history", async () => {
    const creds = await credentials();
    if (!creds) return expect(true).toBe(true);

    const t1 = await responsesTurn1(creds);
    if (!t1.ok) { console.warn(`[skip] turn1 failed ${t1.status}: ${t1.raw}`); return expect(true).toBe(true); }
    const outputMsg = t1.json?.output?.find?.((o) => o.type === "message");
    const text = outputMsg?.content?.map?.((c) => c.text).filter(Boolean).join("") || "";
    const reasoningItem = t1.json?.output?.find?.((o) => o.type === "reasoning");
    console.log(`[turn1] output_text=${JSON.stringify(text.slice(0, 60))} reasoning_item=${!!reasoningItem}`);

    const body = {
      stream: false,
      max_output_tokens: 128,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Think step by step about 17 + 26, then reply with ONLY the number." }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: text || "42" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "What was your final answer?" }] },
      ],
    };
    const out = await send(body, "openai-responses", creds);
    console.log(`[responses no-reasoning] status=${out.status} raw=${out.raw?.slice?.(0, 200)}`);
    // Diagnostic only — a 400 here is the "cc problem" on the responses path.
    expect(out.skip).not.toBe(true);
  }, TIMEOUT_MS);

  it("openai-responses: follow-up WITH reasoning item (Codex-style replay)", async () => {
    const creds = await credentials();
    if (!creds) return expect(true).toBe(true);

    const t1 = await responsesTurn1(creds);
    if (!t1.ok) { console.warn(`[skip] turn1 failed ${t1.status}: ${t1.raw}`); return expect(true).toBe(true); }
    const outputMsg = t1.json?.output?.find?.((o) => o.type === "message");
    const text = outputMsg?.content?.map?.((c) => c.text).filter(Boolean).join("") || "";
    const reasoningItem = t1.json?.output?.find?.((o) => o.type === "reasoning");
    console.log(`[turn1] reasoning item present=${!!reasoningItem}`);

    const body = {
      stream: false,
      max_output_tokens: 128,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Think step by step about 17 + 26, then reply with ONLY the number." }] },
        ...(reasoningItem ? [reasoningItem] : []),
        { type: "message", role: "assistant", content: [{ type: "output_text", text: text || "42" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "What was your final answer?" }] },
      ],
    };
    const out = await send(body, "openai-responses", creds);
    console.log(`[responses with-reasoning] status=${out.status} raw=${out.raw?.slice?.(0, 200)}`);
    expect(out.skip).not.toBe(true);
  }, TIMEOUT_MS);

  it("openai-responses: streaming 2-turn conversation with thinking enabled", async () => {
    const creds = await credentials();
    if (!creds) return expect(true).toBe(true);

    const turn1Body = {
      stream: true,
      max_output_tokens: 1024,
      reasoning: { effort: "high" },
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Think step by step about 12 * 9, then reply with ONLY the number." }] }],
    };
    const t1 = await send(turn1Body, "openai-responses", creds);
    if (!t1.ok) { console.warn(`[skip] turn1 failed ${t1.status}: ${t1.raw}`); return expect(true).toBe(true); }
    console.log(`[responses stream turn1] bytes=${t1.raw.length} marker=${/response\.|"type":"response/.test(t1.raw)}`);

    // Client replays the assistant turn WITHOUT any reasoning content (9router does
    // not inject reasoning_content on the input[] path).
    const turn2Body = {
      stream: true,
      max_output_tokens: 128,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Think step by step about 12 * 9, then reply with ONLY the number." }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "108" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "What was your final answer?" }] },
      ],
    };
    const t2 = await send(turn2Body, "openai-responses", creds);
    console.log(`[responses stream turn2] status=${t2.status} bytes=${t2.raw?.length} marker=${/response\.|"type":"response/.test(t2.raw || "")}`);
    expect(t2.ok).toBe(true);
  }, TIMEOUT_MS);

  it("openai (control): follow-up with reasoning_content in assistant history", async () => {
    const creds = await credentials();
    if (!creds) return expect(true).toBe(true);

    const body = {
      stream: false,
      max_tokens: 1024,
      messages: [
        { role: "user", content: "Think step by step about 17 + 26, then reply with ONLY the number." },
        { role: "assistant", content: "42", reasoning_content: "17 + 26 = 43. Wait, 17+26 = 43? 17+20=37, 37+6=43. Answer: 43." },
        { role: "user", content: "What was your final answer?" },
      ],
    };
    const out = await send(body, "openai", creds);
    console.log(`[openai control] status=${out.status} raw=${out.raw?.slice?.(0, 150)}`);
    // Control: injectReasoningContent covers the chat path; a 400 here is a real bug.
    expect(out.ok).toBe(true);
  }, TIMEOUT_MS);

  it("claude (control): follow-up with plain text assistant turn (known-broken on master)", async () => {
    const creds = await credentials();
    if (!creds) return expect(true).toBe(true);

    const body = {
      stream: false,
      max_tokens: 1024,
      thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [
        { role: "user", content: "Think step by step about 17 + 26, then reply with ONLY the number." },
        { role: "assistant", content: [{ type: "text", text: "43" }] },
        { role: "user", content: "What was your final answer?" },
      ],
    };
    let out;
    try {
      out = await send(body, "claude", creds);
    } catch (e) {
      out = { ok: false, status: "threw", raw: String(e?.message || e) };
    }
    console.log(`[claude control] status=${out.status} raw=${out.raw?.slice?.(0, 200)}`);
    // Known-broken on master (handlesThinkingBlocks excludes opencode-go): we record,
    // not assert — the pass-back fix should flip this to ok.
    expect(out.skip).not.toBe(true);
  }, TIMEOUT_MS);
});
