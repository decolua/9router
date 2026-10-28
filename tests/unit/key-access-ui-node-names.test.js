import { describe, it, expect } from "vitest";
import { PROVIDER_DISPLAY } from "@/shared/constants/providersDisplay.js";

describe("KeyAccessControls UI provider name resolution", () => {
  function resolveProviderName({ providerId, nodeNames = {}, conns = [] }) {
    return (
      nodeNames[providerId] ||
      conns[0]?.providerSpecificData?.nodeName ||
      PROVIDER_DISPLAY[providerId]?.name ||
      providerId
    );
  }

  it("prioritizes nodeNames mapping for custom openai-compatible nodes", () => {
    const providerId = "openai-compatible-chat-8b5e28a1";
    const nodeNames = { [providerId]: "My Local Ollama" };
    const conns = [{ id: "c1", provider: providerId }];

    const name = resolveProviderName({ providerId, nodeNames, conns });
    expect(name).toBe("My Local Ollama");
  });

  it("falls back to conns[0]?.providerSpecificData?.nodeName if not in nodeNames", () => {
    const providerId = "openai-compatible-chat-8b5e28a1";
    const conns = [{
      id: "c1",
      provider: providerId,
      providerSpecificData: { nodeName: "Node From Conn" },
    }];

    const name = resolveProviderName({ providerId, conns });
    expect(name).toBe("Node From Conn");
  });

  it("falls back to PROVIDER_DISPLAY for built-in providers", () => {
    const providerId = "openai";
    const name = resolveProviderName({ providerId });
    expect(name).toBe("OpenAI");
  });

  it("falls back to raw providerId if no display or nodeName exists", () => {
    const providerId = "unknown-custom-service";
    const name = resolveProviderName({ providerId });
    expect(name).toBe("unknown-custom-service");
  });
});

describe("KeyAccessControls UI summary badge calculation", () => {
  function getSummaryBadge(allowedProviders, allow) {
    const pCount = allowedProviders.length;
    const mCount = allow.length;
    if (pCount === 0 && mCount === 0) {
      return "0 providers, 0 models allowed";
    }
    if (pCount > 0 && mCount === 0) {
      return `${pCount} provider${pCount > 1 ? "s" : ""}, all models allowed`;
    }
    if (pCount === 0 && mCount > 0) {
      return `All providers, ${mCount} model${mCount > 1 ? "s" : ""} allowed`;
    }
    return `${pCount} provider${pCount > 1 ? "s" : ""}, ${mCount} model${mCount > 1 ? "s" : ""} allowed`;
  }

  it("calculates summary correctly for empty restrictions", () => {
    expect(getSummaryBadge([], [])).toBe("0 providers, 0 models allowed");
  });

  it("calculates summary correctly for providers only", () => {
    expect(getSummaryBadge(["openai"], [])).toBe("1 provider, all models allowed");
    expect(getSummaryBadge(["openai", "anthropic"], [])).toBe("2 providers, all models allowed");
  });

  it("calculates summary correctly for models only", () => {
    expect(getSummaryBadge([], ["gpt-4o"])).toBe("All providers, 1 model allowed");
    expect(getSummaryBadge([], ["gpt-4o", "claude-3-5-sonnet"])).toBe("All providers, 2 models allowed");
  });

  it("calculates summary correctly for both providers and models", () => {
    expect(getSummaryBadge(["openai"], ["gpt-4o"])).toBe("1 provider, 1 model allowed");
    expect(getSummaryBadge(["openai", "anthropic"], ["gpt-4o", "claude-3-5"])).toBe("2 providers, 2 models allowed");
  });
});
