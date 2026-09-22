// Locks two narrow behaviors added to mitigate OpenRouter's internal "Stealth"
// upstream returning an opaque 502 with message "Invalid URL: " for models
// like `openrouter/fusion` whose primary route is misconfigured upstream of
// 9router.
//
// 1. OpenRouterExecutor.transformRequest injects `provider.allow_fallbacks =
//    true` so OpenRouter can route to an alternate upstream when the primary
//    (e.g. "Stealth") is broken.
// 2. parseUpstreamError annotates 5xx responses whose body matches the OpenRouter
//    Stealth signature with a human-readable hint, so users no longer see an
//    opaque `[502]: Invalid URL:` error.
import { describe, it, expect } from "vitest";

import { OpenRouterExecutor } from "../../open-sse/executors/openrouter.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

describe("OpenRouterExecutor — body transform for provider fallback routing", () => {
  // Use getExecutor("openrouter") via the public registry so we exercise the
  // exact wiring that runs at request-time.

  it("registers a specialized executor for the openrouter provider id", () => {
    const ex = getExecutor("openrouter");
    expect(ex).toBeInstanceOf(OpenRouterExecutor);
  });

  it("injectReasoningContent is preserved (parent hook order unchanged)", () => {
    const ex = getExecutor("openrouter");
    // OpenRouterExecutor extends DefaultExecutor; reasoning injection must
    // still run AFTER allow_fallbacks is injected (parent.transformRequest
    // → injectReasoningContent).
    const body = { model: "fusion", messages: [{ role: "user", content: "hi" }], reasoning_effort: "low" };
    const out = ex.transformRequest("fusion", body);
    // reasoning_effort is a top-level OpenRouter-recognised field — verify it
    // survived the transform (caught a regression where a naive overwrite of
    // body.provider would wipe unrelated top-level keys — sanity guard).
    expect(out.reasoning_effort).toBe("low");
  });

  it("injects provider.allow_fallbacks = true on a bare body", () => {
    const ex = new OpenRouterExecutor();
    const out = ex.transformRequest("fusion", {
      model: "fusion",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.provider).toEqual({ allow_fallbacks: true });
  });

  it("preserves a caller-supplied provider object and only adds allow_fallbacks when missing", () => {
    const ex = new OpenRouterExecutor();
    const out = ex.transformRequest("fusion", {
      model: "fusion",
      provider: { sort: "price", quantizations: ["fp16"] },
    });
    expect(out.provider).toEqual({
      sort: "price",
      quantizations: ["fp16"],
      allow_fallbacks: true,
    });
  });

  it("respects a caller-supplied allow_fallbacks = false (does not overwrite)", () => {
    const ex = new OpenRouterExecutor();
    const out = ex.transformRequest("fusion", {
      model: "fusion",
      provider: { allow_fallbacks: false },
    });
    expect(out.provider).toEqual({ allow_fallbacks: false });
  });

  it("does not coerce a non-object provider value into an object", () => {
    const ex = new OpenRouterExecutor();
    // Some OpenRouter SDKs accept provider as a string id — guard against
    // accidental mutation that would break those SDKs.
    const out = ex.transformRequest("fusion", {
      model: "fusion",
      provider: "Azure",
    });
    expect(out.provider).toBe("Azure");
  });
});

describe("parseUpstreamError — annotate OpenRouter Stealth signature", () => {
  // Minimal Response stub exposing the surface parseUpstreamError uses:
  // .status + .text().
  function makeResponse(status, body) {
    return {
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  }

  it("annotates 502 with provider_name=Stealth and Invalid URL: empty value", async () => {
    const payload = {
      error: {
        message: "Invalid URL: ",
        code: 502,
        metadata: { provider_name: "Stealth" },
      },
      user_id: "user_test",
    };
    const { message } = await parseUpstreamError(
      makeResponse(502, payload),
    );
    // Original message preserved.
    expect(message).toContain("Invalid URL: ");
    // Hint explains the failure mode.
    expect(message).toContain("Stealth");
    expect(message).toContain("misconfigured on OpenRouter's side");
    // Suggests the new opt-in fallback flag.
    expect(message).toContain("allow_fallbacks");
  });

  it("annotates when only message matches Invalid URL: <empty> (no provider_name)", async () => {
    const payload = { error: { message: "Invalid URL:   " } };
    const { message } = await parseUpstreamError(
      makeResponse(500, payload),
    );
    expect(message).toContain("invalid (empty) routing URL");
    expect(message).toContain("allow_fallbacks");
  });

  it("does not annotate unrelated 502 errors", async () => {
    const payload = { error: { message: "Upstream unavailable" } };
    const { message } = await parseUpstreamError(
      makeResponse(502, payload),
    );
    expect(message).toBe("Upstream unavailable");
    expect(message).not.toContain("allow_fallbacks");
  });

  it("does not annotate a 4xx (e.g. 401) even if message starts with Invalid URL", async () => {
    const payload = {
      error: { message: "Invalid URL: ", metadata: { provider_name: "Stealth" } },
    };
    const { message } = await parseUpstreamError(
      makeResponse(401, payload),
    );
    expect(message).toBe("Invalid URL: ");
  });

  it("falls back to raw body when JSON parsing fails", async () => {
    const { message } = await parseUpstreamError(
      makeResponse(502, "not-json"),
    );
    expect(message).toBe("not-json");
    expect(message).not.toContain("allow_fallbacks");
  });
});
