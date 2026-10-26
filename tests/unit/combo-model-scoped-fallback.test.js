/**
 * DF-9ROUTER-34 — a combo whose first model fails with a MODEL-scoped 4xx must
 * advance to its next model.
 *
 * Measured live (pre-fix) with combo `dogfood-fallback` =
 * ["dlm/no-such-model-xyz", "dlm/qwen3.8-27b"]: the FIRST model's upstream 400
 * came back to the client verbatim, model #2 was never attempted, and the server
 * logged `[COMBO] Model dlm/no-such-model-xyz failed (no fallback) {"status":400}`.
 *
 * Cause: the combo loop asked the ACCOUNT-level classifier. `checkFallbackError`
 * deliberately answers `shouldFallback:false` for a 4xx that is not 401/402/403/429
 * (a request-scoped 400 must not cool a healthy credential down — right for
 * auth.js), but the combo loop's next candidate is a DIFFERENT MODEL, not a retry
 * of the same credential. So a model-scoped 400 ("Invalid model identifier") also
 * stopped the ladder on hop 1.
 *
 * Scope of this file:
 *   - `handleComboChat` is driven with an injected `handleSingleModel` stub (the
 *     same transport seam tests/unit/combo-fusion.test.js uses). No network, no
 *     timers, no DB.
 *   - Cases 1-2 are the bug: a model-scoped 4xx (wording / 404-406) must advance.
 *   - Case 3 is the boundary that must NOT move: a request-scoped 400 with no
 *     model wording still hands the upstream answer back (one call only).
 *   - Case 4 is the all-fail collapse (unchanged behaviour, no throw).
 *   - Cases 5-6 pin the credential rule itself: `checkFallbackError`'s 4xx guard is
 *     untouched, and the new combo classifier is a separate entry point.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";
import {
  checkComboFallbackError,
  checkFallbackError,
  isModelScopedError,
} from "../../open-sse/services/accountFallback.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

const body = { model: "dogfood-fallback", messages: [{ role: "user", content: "hi" }] };

// Transport seam. Real Response objects so the engine's `result.clone().json()`
// error extraction runs for real; `attempted` records the model order.
function makeTransport(handlers) {
  const attempted = [];
  const fn = vi.fn(async (_body, modelStr) => {
    attempted.push(modelStr);
    const handler = handlers[modelStr];
    if (!handler) throw new Error(`transport asked for unconfigured model: ${modelStr}`);
    return handler();
  });
  return { fn, attempted };
}

function okResponse(content) {
  return new Response(
    JSON.stringify({ id: "chatcmpl-combo", choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status, message, extra = {}) {
  return new Response(
    JSON.stringify({ error: { message, ...extra } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// The exact upstream answer the dogfood run received for the unknown model.
const INVALID_MODEL_BODY = 'Invalid model identifier "bad-model"';
const dogfoodLadder = ["dlm/no-such-model-xyz", "dlm/qwen3.8-27b"];

async function runCombo(models, handlers, options = {}) {
  const { fn, attempted } = makeTransport(handlers);
  const result = await handleComboChat({
    body,
    models,
    handleSingleModel: fn,
    log,
    comboName: "combo-model-scoped-fallback",
    comboStrategy: "fallback",
    ...options,
  });
  return { result, attempted, fn };
}

describe("combo model-scoped fallback (DF-9ROUTER-34)", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("advances to the next model when the first answers a model-scoped 400", async () => {
    const { result, attempted, fn } = await runCombo(dogfoodLadder, {
      [dogfoodLadder[0]]: () => errorResponse(400, INVALID_MODEL_BODY),
      [dogfoodLadder[1]]: () => okResponse("second model answered"),
    });

    // The 200 from model #2 is what the client sees — not model #1's 400.
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect((await result.json()).choices[0].message.content).toBe("second model answered");

    // Both hops ran, in the configured order (a one-hop stop would be [model #1]).
    expect(attempted).toEqual(dogfoodLadder);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("advances on a 404 model_not_found", async () => {
    const { result, attempted } = await runCombo(["p/gone", "p/present"], {
      "p/gone": () =>
        errorResponse(404, 'The model "p/gone" does not exist', {
          type: "invalid_request_error",
          code: "model_not_found",
        }),
      "p/present": () => okResponse("recovered"),
    });

    expect(attempted).toEqual(["p/gone", "p/present"]);
    expect(result.status).toBe(200);
    expect((await result.json()).choices[0].message.content).toBe("recovered");
  });

  it("advances on a 406 model_not_supported", async () => {
    const { result, attempted } = await runCombo(["p/unsupported", "p/supported"], {
      "p/unsupported": () => errorResponse(406, "model_not_supported", { code: "model_not_supported" }),
      "p/supported": () => okResponse("ok"),
    });

    expect(attempted).toEqual(["p/unsupported", "p/supported"]);
    expect(result.status).toBe(200);
  });

  it("does NOT advance on a request-scoped 400 with no model wording", async () => {
    const upstreamBody = "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens";
    const { result, attempted, fn } = await runCombo(["p/a", "p/b"], {
      "p/a": () => errorResponse(400, upstreamBody, { type: "invalid_request_error" }),
      "p/b": () => okResponse("should never be reached"),
    });

    // Every candidate would answer the same way, so the upstream answer is handed back.
    expect(attempted).toEqual(["p/a"]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect((await result.json()).error.message).toBe(upstreamBody);
  });

  it("collapses to a non-2xx answer when every model fails model-scoped (no throw)", async () => {
    const models = ["p/one", "p/two"];
    const { result, attempted, fn } = await runCombo(models, {
      "p/one": () => errorResponse(400, 'Invalid model identifier "one"'),
      "p/two": () => errorResponse(400, 'Invalid model identifier "two"'),
    });

    expect(attempted).toEqual(models);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    // lastStatus is preserved (the 400 is the honest answer to the client).
    expect(result.status).toBe(400);
    const payload = await result.json();
    expect(payload.error.message).toContain('p/one (400): Invalid model identifier "one"');
    expect(payload.error.message).toContain('p/two (400): Invalid model identifier "two"');
    expect(payload.error.type).toBe("server_error");
    expect(payload.error.attempts).toEqual([
      { seat_id: "p/one", status: 400, error_message: 'Invalid model identifier "one"' },
      { seat_id: "p/two", status: 400, error_message: 'Invalid model identifier "two"' },
    ]);
  });

  /**
   * The credential rule is the boundary that must NOT move: auth.js still asks
   * `checkFallbackError`, whose 4xx guard keeps a request-scoped 400 from cooling
   * a healthy account down. The combo decision lives in its own entry point.
   */
  it("leaves the account-level 4xx guard intact while the combo classifier advances", () => {
    const modelScoped = 'Invalid model identifier "bad-model"';

    // Account scope: unchanged — no cooldown, no credential removed from rotation.
    // (upstream v0.5.111 adds the informational `requestScoped` flag on the 4xx
    // tail; a text-rule hit still returns without it. Either way: no cooldown,
    // no fallback — the guard itself is intact.)
    expect(checkFallbackError(400, modelScoped)).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(checkFallbackError(400, "maximum context length exceeded")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      requestScoped: true,
    });
    // ...while the account-scoped statuses and the rate-limit wording still fall back.
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);

    // Model scope: the combo classifier advances on the same 400, with no cooldown.
    expect(checkComboFallbackError(400, modelScoped)).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(isModelScopedError(400, modelScoped)).toBe(true);

    // The same input only ever classifies ONE way.
    expect(checkComboFallbackError(400, "maximum context length exceeded").shouldFallback).toBe(false);
    expect(isModelScopedError(400, "maximum context length exceeded")).toBe(false);
  });

  it("does not treat server errors or rate limits as model-scoped", () => {
    for (const status of [500, 502, 503, 504, 429]) {
      expect(isModelScopedError(status, "model_not_found")).toBe(false);
    }
    // Request-scoped wordings that name a model parameter but are not a model failure.
    expect(isModelScopedError(400, "This model's maximum context length is 1048576 tokens")).toBe(false);
    expect(isModelScopedError(400, '{"error":{"code":"invalid_parameter","message":"max_tokens must be positive"}}')).toBe(false);
    // 404/406 with an unrecognised statusText must not veto the status itself.
    expect(isModelScopedError(404, "Not Found")).toBe(true);
    expect(isModelScopedError(406, "Not Acceptable")).toBe(true);
    expect(isModelScopedError(404, "")).toBe(true);
    // 5xx wording cannot leak into the model-scoped branch.
    expect(checkComboFallbackError(500, "model_not_found").shouldFallback).toBe(true);
  });
});
