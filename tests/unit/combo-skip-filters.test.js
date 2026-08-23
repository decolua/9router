// The combo cascade passes over entries before trying them. When those filters
// are wrong, a provider with quota disappears from the cascade and the combo
// answers from a much later entry — with nothing in the response to say so.
// These cases pin the conditions under which an entry must still be attempted.
import { describe, it, expect, beforeEach } from "vitest";
import { handleComboChat, resetComboRotation } from "open-sse/services/combo.js";
import { clearQuotaState, isQuotaExhausted, quotaRemainingMs } from "open-sse/services/quotaState.js";
import { clearModelCooldowns, isModelCoolingDown } from "open-sse/services/modelCooldown.js";
import { clearModelHealth } from "open-sse/services/modelHealth.js";

const log = { info() {}, warn() {}, debug() {} };
const AG = "ag/gemini-3.1-pro-low";
// A genuinely SMALL member. This was ag/claude-opus-4-6-thinking while that id
// was declared 200k — a declaration probed and disproved on 2026-08-24 (362,664
// tokens accepted and answered), so it is now 1,000,000 and can no longer play
// the part. The test is about skipping a member too small for the request, not
// about this particular id.
const SMALL = "ag/gpt-oss-120b-medium";        // 128k context window
const DEEPSEEK = "ocg/deepseek-v4-pro";

const ok = (model) =>
  new Response(JSON.stringify({ model }), { status: 200, headers: { "Content-Type": "application/json" } });

// What the app-side account loop returns when every currently selectable account
// of a provider is locked for this model: the provider's own text, re-quoted, and
// flagged as our synthesis rather than a fresh provider verdict.
const unavailable = (model, status, msg) =>
  new Response(JSON.stringify({
    error: { message: `[${model}] ${msg} (reset after 30s)` },
    retryAfter: new Date(Date.now() + 30_000).toISOString(),
    accountsLocked: true,
  }), { status, headers: { "Content-Type": "application/json" } });

// A verdict straight from the provider, with no account layer in between.
const providerError = (status, msg) =>
  new Response(JSON.stringify({ error: { message: msg } }),
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
    const canServe = () => ({ serveable: true });

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
    const canServe = (m) => ({ serveable: serveable.has(m), retryAfter: null });

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
      { canServe: () => ({ serveable: true }) });

    expect(isQuotaExhausted(AG)).toBe(false);
  });

  it("a one-off 500 does not sideline the model for later requests", async () => {
    await run([AG, DEEPSEEK],
      async (_b, m) => (m === AG ? unavailable(m, 500, "boom") : ok(m)),
      { canServe: () => ({ serveable: true }) });

    expect(isModelCoolingDown(AG)).toBe(false);
  });

  it("bounds a quota ban by the reset time the provider reported", async () => {
    const retryAfter = new Date(Date.now() + 2_000).toISOString();
    await run([AG, DEEPSEEK], async (_b, m) => (m === AG
      ? new Response(JSON.stringify({ error: { message: "Quota exceeded" }, retryAfter }),
        { status: 429, headers: { "Content-Type": "application/json" } })
      : ok(m)));

    expect(isQuotaExhausted(AG)).toBe(true);
    expect(quotaRemainingMs(AG)).toBeLessThanOrEqual(2_000); // not the default hour
  });

  it("still remembers a provider's own verdict when no account layer is present", async () => {
    await run([AG, DEEPSEEK], async (_b, m) =>
      (m === AG ? providerError(429, "You exceeded your current quota") : ok(m)));

    expect(isQuotaExhausted(AG)).toBe(true);
    expect(quotaRemainingMs(AG)).toBeGreaterThan(60_000);
  });

  it("the output budget does not count against an input context window", async () => {
    // Input sized to fit a 200k window AFTER CONTEXT_ESTIMATE_SAFETY, plus a 64k
    // output budget. If the output allowance were counted against the input window
    // the total would exceed 200k and SMALL would be skipped — that is what this
    // asserts, and it is unchanged.
    //
    // The magnitudes moved 2026-08-23. This case previously used 600_000 chars and
    // called it "~150k tokens", which is the flat 4 chars/token assumption that
    // proved wrong in production: a provider measured a 602,528-char body at 391,532
    // tokens. Sizing now applies CONTEXT_ESTIMATE_SAFETY (2.5x), so 600_000 chars is
    // treated as 375k and no longer fits 200k — correctly. 240_000 chars is 60k raw,
    // 150k adjusted, which fits 200k with room for the 64k output budget to matter.
    // Sized against SMALL's 128k input window, not the 200k this case used while
    // it pointed at an id since measured at 1M. Uncalibrated sizing is
    // estimateInputTokens (~chars/4) x CONTEXT_ESTIMATE_SAFETY (2.5), i.e.
    // chars x 0.625: 160,000 chars -> ~100k tokens. That fits 128k on its own,
    // and would NOT fit if the 64k output budget were subtracted from the input
    // window — which is precisely the mistake this test exists to catch.
    const body = { messages: [{ role: "user", content: "x".repeat(160_000) }], max_tokens: 64_000 };
    const tried = [];
    await handleComboChat({
      body, models: [SMALL, DEEPSEEK], log, comboName: "test-combo", comboStrategy: "fallback",
      handleSingleModel: async (_b, m) => { tried.push(m); return ok(m); },
    });
    expect(tried).toContain(SMALL);
  });

  it("still skips a model whose input window cannot fit the request at all", async () => {
    const body = { messages: [{ role: "user", content: "x".repeat(1_200_000) }] }; // ~300k tokens
    const tried = [];
    await handleComboChat({
      body, models: [SMALL, DEEPSEEK], log, comboName: "test-combo", comboStrategy: "fallback",
      handleSingleModel: async (_b, m) => { tried.push(m); return ok(m); },
    });
    expect(tried).not.toContain(SMALL);
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

  it("keeps its own memory for providers the account layer has no opinion on", async () => {
    // No-auth free providers never get an account lock written against them, so
    // "no opinion" must not read as capacity — the per-model ban is all there is.
    const canServe = () => null;

    await run([AG, DEEPSEEK],
      async (_b, m) => (m === AG ? providerError(429, "You exceeded your current quota") : ok(m)),
      { canServe });
    expect(isQuotaExhausted(AG)).toBe(true);

    const tried = [];
    await run([AG, DEEPSEEK], async (_b, m) => { tried.push(m); return ok(m); }, { canServe });
    expect(tried).not.toContain(AG);
  });

  it("tells the client when to come back once the skipped entries have also failed", async () => {
    const retryAfter = new Date(Date.now() + 600_000).toISOString();
    // "Every entry was skipped" is no longer a terminal state: the second pass
    // retries supply-side skips rather than report exhaustion with untried models
    // behind it. So the handler must fail for the cascade to refuse at all, and
    // the refusal now carries a real attempt's status instead of the 503 the skip
    // path used to synthesize. What this case actually pins is unchanged — the
    // client is handed a retryable code and a time to come back.
    const res = await run([AG, DEEPSEEK], async (_b, m) => unavailable(m, 429, "Rate limit exceeded"),
      { canServe: () => ({ serveable: false, retryAfter }) });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect((await res.json()).error.message).toContain(DEEPSEEK);
  });

  it("does not let a permanent-looking last entry bury a retryable earlier one", async () => {
    const res = await run(
      [AG, "gemini/gemini-3.1-pro-preview"],
      async (_b, m) => (m === AG
        ? providerError(429, "Rate limit exceeded")
        : providerError(400, "API key not valid")),
    );
    expect(res.status).toBe(429);
  });

  it("answers with a retryable status when the cascade failed for transient reasons", async () => {
    const res = await run(
      [AG, DEEPSEEK],
      async (_b, _m) => unavailable(_m, 429, "[429]: Quota exceeded for this model"),
      { canServe: () => ({ serveable: true }) },
    );
    expect([429, 503]).toContain(res.status);
  });
});
