// Looking at an image is the cheapest thing a vision model does. A combo ordered
// capability-first would otherwise hand every screenshot to its most expensive
// member, because capability alone put the paid entries at the front.
//
// The second case here is not a preference: Claude served through Antigravity is
// advertised as vision-capable and silently does not receive the image, so a combo
// that picks it answers a confident guess instead of failing.
import { describe, it, expect } from "vitest";
import { reorderByCapabilities } from "open-sse/services/combo.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

const VISION = new Set(["vision"]);

// The live Yggdrasil order after the tuner's capability-first pass, paid entries first.
const YGGDRASIL = [
  "ag/claude-opus-4-6-thinking",
  "cmc/deepseek/deepseek-v4-pro",
  "ocg/qwen3.7-max",
  "ag/gemini-pro-agent",
  "tokenrouter/deepseek/deepseek-v4-pro-0813-free",
  "kr/claude-sonnet-4.5",
  "ollama/minimax-m3",
  "gemini/gemini-3.6-flash",
];

describe("vision routing picks a free model that can actually see", () => {
  it("puts a free vision model ahead of a paid one", () => {
    const out = reorderByCapabilities(YGGDRASIL, VISION);
    const head = out[0];
    const slash = head.indexOf("/");
    expect(getCapabilitiesForModel(head.slice(0, slash), head.slice(slash + 1)).vision).toBe(true);
    expect(["kr", "ollama", "gemini", "gc", "bb"]).toContain(head.slice(0, slash));
  });

  it("never leads with Claude-via-Antigravity, which does not receive the image", () => {
    // Measured 2026-08-23: SEEN=NO from ag/claude-opus-4-6-thinking and
    // ag/claude-sonnet-4-6; SEEN=YES from ag/gemini-pro-agent on the same request.
    const out = reorderByCapabilities(YGGDRASIL, VISION);
    expect(out[0]).not.toBe("ag/claude-opus-4-6-thinking");
    // and it is not silently dropped either — the cascade keeps every entry
    expect(out).toHaveLength(YGGDRASIL.length);
    expect(new Set(out)).toEqual(new Set(YGGDRASIL));
  });

  it("still keeps a paid vision model ahead of a free model that cannot see", () => {
    // Cost breaks ties inside a tier; it must not promote a blind model over a
    // seeing one, or the image is lost to save nothing.
    const out = reorderByCapabilities(["tokenrouter/qwen/qwen3.8-max-free", "ag/gemini-pro-agent"], VISION);
    expect(out[0]).toBe("ag/gemini-pro-agent");
  });

  it("leaves order untouched when the request needs nothing special", () => {
    const out = reorderByCapabilities(YGGDRASIL, new Set());
    expect(out).toBe(YGGDRASIL);
  });

  it("is stable among equally-priced capable models", () => {
    const models = ["kr/claude-sonnet-4.5", "ollama/minimax-m3", "gemini/gemini-3.6-flash"];
    expect(reorderByCapabilities(models, VISION)).toEqual(models);
  });
});
