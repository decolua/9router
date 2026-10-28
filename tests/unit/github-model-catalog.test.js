import { describe, expect, it } from "vitest";
import {
  getDefaultModel,
  getModelTargetFormat,
  getModelType,
  getModelsByProviderId,
  isValidModel,
} from "../../open-sse/config/providerModels.js";

describe("GitHub Copilot fallback catalog", () => {
  it.each([
    "gpt-5-mini", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra",
    "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol",
    "claude-fable-5", "claude-fable-5.1", "claude-haiku-5.5",
    "claude-opus-4.8", "claude-opus-4.8-fast", "claude-opus-5", "claude-opus-5.5",
    "claude-sonnet-5", "claude-sonnet-5.5",
    "gemini-3.7-flash", "gemini-3.8-flash", "gemini-4-argon",
    "kimi-k3", "mai-code-1.1-flash",
  ])("accepts verified public model %s when live discovery is unavailable", (id) => {
    expect(isValidModel("gh", id)).toBe(true);
    expect(getModelsByProviderId("github").some((model) => model.id === id)).toBe(true);
  });

  it("uses a current chat model as the default", () => {
    expect(getDefaultModel("gh")).toBe("gpt-5-mini");
  });

  it.each(["gpt-5.2", "claude-opus-4.5", "gemini-2.5-pro"])(
    "does not offer retired model %s as a fallback", (id) => {
      expect(isValidModel("gh", id)).toBe(false);
    },
  );

  it.each(["gpt-5.", "copilot-search-a", "exec-agent-a"])(
    "does not seed incomplete or internal model %s", (id) => {
      expect(isValidModel("gh", id)).toBe(false);
    },
  );

  it("keeps embedding models separate from chat models", () => {
    expect(getModelType("gh", "text-embedding-3-small")).toBe("embedding");
    expect(getModelType("gh", "text-embedding-ada-002")).toBe("embedding");
  });

  it("leaves Claude format selection to the executor to avoid double translation", () => {
    for (const model of getModelsByProviderId("github").filter((m) => m.id.startsWith("claude-"))) {
      expect(getModelTargetFormat("gh", model.id)).toBeNull();
    }
  });
});
