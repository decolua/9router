// The combo cascade passes over entries before trying them. When those filters
// are wrong, a provider with quota disappears from the cascade and the combo
// answers from a much later entry — with nothing in the response to say so.
// These cases pin the conditions under which an entry must still be attempted.
import { describe, it, expect, beforeEach } from "vitest";
import { handleComboChat, resetComboRotation } from "open-sse/services/combo.js";
import { clearQuotaState, isQuotaExhausted } from "open-sse/services/quotaState.js";
import { clearModelCooldowns, isModelCoolingDown } from "open-sse/services/modelCooldown.js";
import { clearModelHealth } from "open-sse/services/modelHealth.js";

const log = { info() {}, warn() {}, debug() {} };
const AG = "ag/gemini-3.1-pro-low";
const OPUS = "ag/claude-opus-4-6-thinking";   // 200k context window
const DEEPSEEK = "ocg/deepseek-v4-pro";

const ok = (model) =>
  new Response(JSON.stringify({ model }), { status: 200, headers: { "Content-Type": "application/json" } });

// What the app-side account loop returns when every currently selectable account
// of a provider is locked for this model: the provider's own text, re-quoted.
const unavailable = (model, status, msg) =>
  new Response(JSON.stringify({ error: { message: `[${model}] ${msg} (reset after 30s)` } }),
    { status, headers: { "Content-Type": "application/json" } });

const run = (models, handler, opts = {}) =>
  handleComboChat({
    body: { messages: [] },
    models,
    handleSingleModel: handler,
    log,
    comboName: "test-combo",
    comboStrategy: "fallback",
    ...opts,
  });

beforeEach(() => {
  resetComboRotation();
  clearQuotaState();
  clearModelCooldowns();
  clearModelHealth();
});

describe("combo skip filters", () => {
  it("one account's quota error does not ban the model for accounts that still have quota", async () => {
    // canServe reports the provider still has a usable account — which is the
    // whole point: the ban must not outlive the account that earned it.
    const canServe = () => true;

    await run([AG, DEEPSEEK],
      async (_b, m) => (m === AG ? unavailable(m, 429, "[429]: Quota exceeded for this model") : ok(m)),
      { canServe });

    const tried = [];
    const res = await run([AG, DEEPSEEK], async (_b, m) => { tried.push(m); return ok(m); }, { canServe });

    expect(tried).toContain(AG);
    expect((await res.json()).model).toBe(AG);
  });

  it("skips a model only while every account for it is genuinely out", async () => {
    const serveable = new Set([DEEPSEEK]);
    const canServe = (m) => serveable.has(m);

    const tried = [];
    await run([AG, DEEPSEEK], async (_b, m) => { tried.push(m); return ok(m); }, { canServe });
    expect(tried).not.toContain(AG);

    // An account resets / is re-enabled / is added: the entry is live again at once.
    serveable.add(AG);
    const tried2 = [];
    await run([AG, DEEPSEEK], async (_b, m) => { tried2.push(m); return ok(m); }, { canServe });
    expect(tried2).toContain(AG);
  });

  it("does not treat the router's own all-accounts-locked reply as fresh quota evidence", async () => {
    await run([AG, DEEPSEEK],
      async (_b, m) => (m === AG
        ? unavailable(m, 429, "[429]: Quota exceeded for this model")
        : ok(m)),
      { canServe: () => true });

    expect(isQuotaExhausted(AG)).toBe(false);
  });

  it("a one-off 500 does not sideline the model for later requests", async () => {
    await run([AG, DEEPSEEK],
      async (_b, m) => (m === AG ? unavailable(m, 500, "boom") : ok(m)),
      { canServe: () => true });

    expect(isModelCoolingDown(AG)).toBe(false);
  });

  it("the output budget does not count against an input context window", async () => {
    // ~150k estimated input tokens plus a 64k output budget. The input fits a
    // 200k window; the output allowance is a separate budget upstream.
    const body = { messages: [{ role: "user", content: "x".repeat(600_000) }], max_tokens: 64_000 };
    const tried = [];
    await handleComboChat({
      body, models: [OPUS, DEEPSEEK], log, comboName: "test-combo", comboStrategy: "fallback",
      handleSingleModel: async (_b, m) => { tried.push(m); return ok(m); },
    });
    expect(tried).toContain(OPUS);
  });

  it("still skips a model whose input window cannot fit the request at all", async () => {
    const body = { messages: [{ role: "user", content: "x".repeat(1_200_000) }] }; // ~300k tokens
    const tried = [];
    await handleComboChat({
      body, models: [OPUS, DEEPSEEK], log, comboName: "test-combo", comboStrategy: "fallback",
      handleSingleModel: async (_b, m) => { tried.push(m); return ok(m); },
    });
    expect(tried).not.toContain(OPUS);
    expect(tried).toContain(DEEPSEEK);
  });

  it("reports the status of the error it quotes when every entry fails", async () => {
    const res = await run(
      ["tokenrouter/kimi", "gemini/gemini-3.1-pro-preview"],
      async (_b, m) => (m.startsWith("tokenrouter/")
        ? unavailable(m, 410, "gone")
        : unavailable(m, 400, "[400]: API key not valid")),
    );
    const msg = (await res.json()).error.message;

    expect(msg).toContain("gemini/gemini-3.1-pro-preview");
    expect(res.status).toBe(400);
  });

  it("answers with a retryable status when the cascade failed for transient reasons", async () => {
    const res = await run(
      [AG, DEEPSEEK],
      async (_b, _m) => unavailable(_m, 429, "[429]: Quota exceeded for this model"),
      { canServe: () => true },
    );
    expect([429, 503]).toContain(res.status);
  });
});
