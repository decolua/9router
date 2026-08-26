// A combo must not report exhaustion while it still holds entries it never tried.
// Every skip in the cascade is a PREDICTION — a cooldown guesses when a provider
// recovers, a quota ban defaults to an hour whether or not the provider said so,
// and the account probe answers for the account layer's bookkeeping rather than
// for the upstream. Those predictions are worth honouring while something else can
// answer, and worth spending one request to test when nothing else can.
//
// The other half is the clock. A provider that accepts the connection and then
// goes quiet used to consume the client's entire budget with a full pool of untried
// models behind it — a hang, reported as a timeout, that no fallback ever saw.
import { describe, it, expect, beforeEach } from "vitest";
import { handleComboChat } from "open-sse/services/combo.js";
import { clearQuotaState, markQuotaExhausted } from "open-sse/services/quotaState.js";
import { clearModelCooldowns, markModelCooldown } from "open-sse/services/modelCooldown.js";
import { clearModelHealth } from "open-sse/services/modelHealth.js";

const log = { info() {}, warn() {}, debug() {}, error() {} };
const ok = (model) =>
  new Response(JSON.stringify({ model }), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (status, msg) =>
  new Response(JSON.stringify({ error: { message: msg } }), { status, headers: { "Content-Type": "application/json" } });

const run = (models, handler, opts = {}) =>
  handleComboChat({
    body: { messages: [] },
    models,
    handleSingleModel: handler,
    log,
    comboName: "never-dry",
    comboStrategy: "fallback",
    ...opts,
  });

beforeEach(() => {
  clearQuotaState();
  clearModelCooldowns();
  clearModelHealth();
});

describe("combo second pass — never exhaust while entries are untried", () => {
  it("retries a quota-banned entry rather than answer 503 with it untouched", async () => {
    markQuotaExhausted("a/one", Date.now(), 60 * 60_000);
    markQuotaExhausted("a/two", Date.now(), 60 * 60_000);
    const tried = [];

    const res = await run(["a/one", "a/two"], async (_b, m) => {
      tried.push(m);
      return m === "a/two" ? ok(m) : fail(429, "still out");
    });

    expect(res.status).toBe(200);
    expect(tried).toEqual(["a/one", "a/two"]);
  });

  it("retries an entry the account probe refused", async () => {
    const tried = [];
    const res = await run(["a/one"], async (_b, m) => { tried.push(m); return ok(m); }, {
      canServe: () => ({ serveable: false, retryAfter: new Date(Date.now() + 600_000).toISOString() }),
    });

    expect(res.status).toBe(200);
    expect(tried).toEqual(["a/one"]);
  });

  it("does not run the second pass when a first-pass entry answered", async () => {
    markModelCooldown("a/cold", Date.now() + 60_000);
    const tried = [];

    const res = await run(["a/cold", "a/warm"], async (_b, m) => { tried.push(m); return ok(m); });

    expect(res.status).toBe(200);
    // a/cold stays skipped: the prediction is only overridden when honouring it
    // would mean refusing the request outright.
    expect(tried).toEqual(["a/warm"]);
  });

  it("tries each deferred entry once, not once per failure", async () => {
    markModelCooldown("a/one", Date.now() + 60_000);
    markModelCooldown("a/two", Date.now() + 60_000);
    const tried = [];

    await run(["a/one", "a/two"], async (_b, m) => { tried.push(m); return fail(429, "no"); });

    expect(tried).toEqual(["a/one", "a/two"]);
  });

  it("still refuses an oversized request instead of retrying it everywhere", async () => {
    // 200k window models against a request far past it. No amount of retrying
    // shrinks a conversation, so this skip must NOT come back in the second pass.
    const huge = "x".repeat(4_000_000);
    const tried = [];

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: huge }] },
      models: ["ag/claude-opus-4-6-thinking"],
      handleSingleModel: async (_b, m) => { tried.push(m); return ok(m); },
      log,
      comboName: "never-dry",
      comboStrategy: "fallback",
    });

    expect(res.status).toBe(413);
    expect(tried).toEqual([]);
  });
});

describe("combo deadline — a silent upstream cascades instead of hanging", () => {
  it("moves to the next entry when a provider never returns a response", async () => {
    process.env.COMBO_RESPONSE_TIMEOUT_MS = "60";
    const { resetModules } = await import("vitest").then((m) => ({ resetModules: m.vi.resetModules }));
    resetModules();
    const { handleComboChat: fresh } = await import("open-sse/services/combo.js");

    const tried = [];
    const res = await fresh({
      body: { messages: [] },
      models: ["a/hangs", "a/answers"],
      handleSingleModel: async (_b, m) => {
        tried.push(m);
        if (m === "a/hangs") return new Promise(() => {}); // never settles
        return ok(m);
      },
      log,
      comboName: "never-dry",
      comboStrategy: "fallback",
    });

    delete process.env.COMBO_RESPONSE_TIMEOUT_MS;
    expect(tried).toEqual(["a/hangs", "a/answers"]);
    expect(res.status).toBe(200);
  });
});
