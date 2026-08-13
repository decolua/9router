/**
 * Codex image adapter: the accelerated ("fast") service tier must reach the
 * Responses backend on the image path, not just the chat path.
 *
 * Before this, imageProviders/codex.js built its own body and never set
 * service_tier, so a fast-tier image request was silently downgraded.
 */

import { describe, it, expect } from "vitest";
import codexImageAdapter from "../../open-sse/handlers/imageProviders/codex.js";
import { normalizeCodexServiceTier } from "../../open-sse/shared/codexServiceTier.js";

const MODEL = "gpt-5.5-image";
const PROMPT = "A cute cat wearing a hat";

function build(extra = {}) {
  return codexImageAdapter.buildBody(MODEL, { prompt: PROMPT, ...extra });
}

describe("normalizeCodexServiceTier", () => {
  it.each([
    ["fast", "priority"],
    ["priority", "priority"],
    ["FAST", "priority"],
    ["  fast  ", "priority"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizeCodexServiceTier(input)).toBe(expected);
  });

  it.each([undefined, null, "", "flex", "default", "auto", 42, {}])(
    "drops unrecognized tier %s",
    (input) => {
      expect(normalizeCodexServiceTier(input)).toBeNull();
    }
  );
});

describe("codex image adapter service_tier", () => {
  it("forwards the fast tier as priority", () => {
    expect(build({ service_tier: "fast" }).service_tier).toBe("priority");
  });

  it("passes priority through unchanged", () => {
    expect(build({ service_tier: "priority" }).service_tier).toBe("priority");
  });

  it("omits service_tier entirely when not requested", () => {
    expect("service_tier" in build()).toBe(false);
  });

  it("omits an unrecognized tier rather than forwarding it upstream", () => {
    expect("service_tier" in build({ service_tier: "flex" })).toBe(false);
  });

  it("leaves the rest of the image payload untouched", () => {
    const body = build({ service_tier: "fast", size: "1024x1024", quality: "low" });
    expect(body.model).toBe("gpt-5.5");
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.tools[0]).toMatchObject({
      type: "image_generation",
      size: "1024x1024",
      quality: "low",
      output_format: "png",
    });
  });
});
