// Regression: the [1m] context marker must default from a model's real window,
// and the marker helpers must stay idempotent.
//
// Claude Code assumes a 200K window unless the model name carries `[1m]`; a 1M
// model otherwise reads as "100% context used" and clamps auto-compact. The
// server now auto-marks a mapping when its model declares a >= 1M window.
import { describe, expect, it } from "vitest";
import {
  shouldMarkOneMContext,
  withContextMarker,
  splitModelRef,
} from "../../open-sse/utils/modelMarkers.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Mirror the route's resolver: alias -> provider id -> caps.contextWindow.
const ALIAS_TO_ID = { cbai: "codebuddy-intl", cbcn: "codebuddy-cn" };
const resolve = (prefix, model) =>
  getCapabilitiesForModel(prefix ? (ALIAS_TO_ID[prefix] || prefix) : null, model)?.contextWindow;

describe("shouldMarkOneMContext", () => {
  it("marks a CodeBuddy 1M model (alias-prefixed)", () => {
    expect(shouldMarkOneMContext("cbai/glm-5.2", resolve)).toBe(true);
    expect(shouldMarkOneMContext("cbai/deepseek-v4.1-flash", resolve)).toBe(true);
  });

  it("does not mark a sub-1M model", () => {
    expect(shouldMarkOneMContext("cbai/hy3", resolve)).toBe(false); // 192k
    expect(shouldMarkOneMContext("cbai/kimi-k2.6", resolve)).toBe(false); // 256k
  });

  it("is idempotent when the marker is already present", () => {
    expect(shouldMarkOneMContext("cbai/glm-5.2[1m]", resolve)).toBe(false);
  });

  it("ignores empty values", () => {
    expect(shouldMarkOneMContext("", resolve)).toBe(false);
    expect(shouldMarkOneMContext(undefined, resolve)).toBe(false);
  });
});

describe("marker helpers", () => {
  it("withContextMarker is idempotent (no [1m][1m])", () => {
    expect(withContextMarker("cbai/glm-5.2", true)).toBe("cbai/glm-5.2[1m]");
    expect(withContextMarker("cbai/glm-5.2[1m]", true)).toBe("cbai/glm-5.2[1m]");
    expect(withContextMarker("cbai/glm-5.2[1m]", false)).toBe("cbai/glm-5.2");
  });

  it("splitModelRef separates prefix and model, dropping the marker", () => {
    expect(splitModelRef("cbai/glm-5.2[1m]")).toEqual({ prefix: "cbai", model: "glm-5.2" });
    expect(splitModelRef("glm-5.2")).toEqual({ prefix: null, model: "glm-5.2" });
  });
});
