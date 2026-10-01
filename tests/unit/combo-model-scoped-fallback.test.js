import { describe, expect, it } from "vitest";

import { checkFallbackError, isModelScopedError } from "../../open-sse/services/accountFallback.js";

// #4271: a combo whose first member is unusable for the current account used to
// return that member's 4xx verbatim and never reach the healthy members behind
// it. isModelScopedError() is what lets combo rotation advance in that case,
// while checkFallbackError() keeps its existing account-rotation semantics.

describe("isModelScopedError", () => {
  it("detects an unentitled slug (400, Codex wording from #4271)", () => {
    const text = JSON.stringify({
      detail: "The 'model-x' model is not supported when using Codex with a ChatGPT account.",
    });
    expect(isModelScopedError(400, text)).toBe(true);
  });

  it("detects a retired model (410)", () => {
    const text = JSON.stringify({
      type: "about:blank",
      title: "Gone",
      status: 410,
      detail: "The model 'model-y' has reached its end of life on <DATE> and is no longer available.",
    });
    expect(isModelScopedError(410, text)).toBe(true);
  });

  it("detects other common model-scoped phrasings", () => {
    const cases = [
      [404, "model_not_found"],
      [404, "The model does not exist"],
      [400, "You do not have access to this model"],
      [400, "model is deprecated"],
      [400, "unsupported model"],
    ];
    for (const [status, text] of cases) {
      expect(isModelScopedError(status, text), `${status} ${text}`).toBe(true);
    }
  });

  it("does NOT treat a genuine request-scoped 400 as model-scoped", () => {
    // Retrying the same request against other models cannot help, and
    // burning the combo on it would hide the real cause from the caller.
    const overflow = JSON.stringify({ error: { message: "maximum context length is 8192 tokens" } });
    expect(isModelScopedError(400, overflow)).toBe(false);
    expect(isModelScopedError(400, "improperly formed request")).toBe(false);
    expect(isModelScopedError(400, "invalid json body")).toBe(false);
  });

  it("does NOT match availability wording that has nothing to do with the model", () => {
    // A bare "is not available" would catch all of these and let a combo skip a
    // member for the wrong reason. The phrases are anchored on "model" instead.
    for (const text of [
      "prompt is not available",
      "region is not available",
      "this content is not available",
      "service temporarily unavailable",
    ]) {
      expect(isModelScopedError(400, text), text).toBe(false);
    }
  });

  it("never flags account-scoped statuses, even when the text mentions a model", () => {
    // A 403 on a specific slug is a permission problem: rotate the account,
    // not the model.
    expect(isModelScopedError(403, "you do not have access to this model")).toBe(false);
    expect(isModelScopedError(401, "invalid model token")).toBe(false);
    expect(isModelScopedError(429, "rate limit reached for model-x")).toBe(false);
  });

  it("ignores 5xx (already falls back everywhere) and empty input", () => {
    expect(isModelScopedError(500, "internal error")).toBe(false);
    expect(isModelScopedError(503, "service unavailable")).toBe(false);
    expect(isModelScopedError(400, "")).toBe(false);
    expect(isModelScopedError(400, null)).toBe(false);
  });
});

describe("account rotation keeps its existing 4xx behaviour (#4271 guard)", () => {
  // checkFallbackError() is used by src/sse/services/auth.js for ACCOUNT
  // rotation. It must keep declining to cool an account down for a
  // request-scoped 4xx — that reasoning is correct there and is only bypassed
  // on the combo path.
  it("still declines fallback for a request-scoped 400", () => {
    expect(checkFallbackError(400, "maximum context length is 8192 tokens").shouldFallback).toBe(false);
  });

  it("still declines fallback for a model-scoped 400 on the account path", () => {
    // The bypass lives in combo.js, not here — an account must not be cooled
    // down because one slug is unentitled; other slugs may work.
    const text = "The 'model-x' model is not supported when using Codex with a ChatGPT account.";
    expect(checkFallbackError(400, text).shouldFallback).toBe(false);
  });

  it("still falls back for account-scoped statuses and rate-limit wording", () => {
    expect(checkFallbackError(401, "bad key").shouldFallback).toBe(true);
    expect(checkFallbackError(403, "forbidden").shouldFallback).toBe(true);
    expect(checkFallbackError(429, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(500, "boom").shouldFallback).toBe(true);
  });
});
