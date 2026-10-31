import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getDeactivatedProviderIds } from "@/shared/utils/connectionStatus.js";

describe("getDeactivatedProviderIds", () => {
  it("identifies providers with connections where all are isActive === false", () => {
    const connections = [
      { provider: "openai-compatible-chat-1", name: "Conn 1", isActive: false },
      { provider: "openai-compatible-chat-1", name: "Conn 2", isActive: false },
      { provider: "gemini", name: "Gemini 1", isActive: false },
    ];
    const deactivated = getDeactivatedProviderIds(connections);
    expect(deactivated.has("openai-compatible-chat-1")).toBe(true);
    expect(deactivated.has("gemini")).toBe(true);
    expect(deactivated.size).toBe(2);
  });

  it("does not deactivate provider if at least one connection is active", () => {
    const connections = [
      { provider: "openai-compatible-chat-1", name: "Conn 1", isActive: false },
      { provider: "openai-compatible-chat-1", name: "Conn 2", isActive: true },
      { provider: "anthropic", name: "Anthropic 1", isActive: true },
    ];
    const deactivated = getDeactivatedProviderIds(connections);
    expect(deactivated.has("openai-compatible-chat-1")).toBe(false);
    expect(deactivated.has("anthropic")).toBe(false);
    expect(deactivated.size).toBe(0);
  });

  it("does not deactivate providers with 0 connections (e.g. keyless local Ollama)", () => {
    const connections = [
      { provider: "other-provider", name: "Other", isActive: false },
    ];
    const deactivated = getDeactivatedProviderIds(connections);
    // Provider not in connections array is not considered deactivated
    expect(deactivated.has("local-ollama-node")).toBe(false);
  });

  it("handles empty or null connections list safely", () => {
    expect(getDeactivatedProviderIds([]).size).toBe(0);
    expect(getDeactivatedProviderIds(null).size).toBe(0);
    expect(getDeactivatedProviderIds(undefined).size).toBe(0);
  });
});

describe("ModelSelectModal source verification for deactivated providers", () => {
  const fileUrl = new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url);
  const src = fs.readFileSync(fileUrl, "utf-8");

  it("imports and uses getDeactivatedProviderIds", () => {
    expect(src).toContain("getDeactivatedProviderIds");
    expect(src).toContain("deactivatedProviderIds");
  });

  it("filters compatibleNodeIds by !deactivatedProviderIds.has(alias)", () => {
    expect(src).toMatch(/!deactivatedProviderIds\.has\(alias\)/);
  });

  it("filters providerIdsToShow by !deactivatedProviderIds.has(id)", () => {
    expect(src).toMatch(/!deactivatedProviderIds\.has\(id\)/);
  });

  it("fetches /api/providers on modal open", () => {
    expect(src).toContain('fetch("/api/providers")');
  });
});
