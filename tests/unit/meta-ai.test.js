import { describe, it, expect } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

describe("meta registry", () => {
  it("is registered with the OpenAI-compatible base URL", () => {
    expect(PROVIDERS["meta"]).toBeTruthy();
    expect(PROVIDERS["meta"].baseUrl).toBe("https://api.meta.ai/v1/chat/completions");
    expect(PROVIDERS["meta"].thinkingFormat).toBe("meta");
  });
});

describe("meta capabilities", () => {
  it("Muse Spark reasons and cannot disable thinking", () => {
    const caps = getCapabilitiesForModel("meta", "muse-spark-1.2");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("meta");
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("exposes minimal/low/medium/high/xhigh levels (no none, no max)", () => {
    const levels = getThinkingLevels("meta", "muse-spark-1.2");
    expect(levels).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
  });
});

describe("meta thinking mapping", () => {
  it("passes supported levels through", () => {
    for (const level of ["minimal", "low", "medium", "high", "xhigh"]) {
      const body = {};
      applyThinking("meta", "muse-spark-1.2", body, "meta", { mode: "level", level });
      expect(body.reasoning_effort).toBe(level);
    }
  });

  it("clamps max to xhigh (Muse Spark has no max)", () => {
    const body = {};
    applyThinking("meta", "muse-spark-1.2", body, "meta", { mode: "level", level: "max" });
    expect(body.reasoning_effort).toBe("xhigh");
  });

  it("omits reasoning_effort for a literal none level (upstream rejects none)", () => {
    const body = {};
    applyThinking("meta", "muse-spark-1.2", body, "meta", { mode: "level", level: "none" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("clamps the none mode to minimal (cannot disable thinking)", () => {
    const body = {};
    applyThinking("meta", "muse-spark-1.2", body, "meta", { mode: "none" });
    expect(body.reasoning_effort).toBe("minimal");
  });
});