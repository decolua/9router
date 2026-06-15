import { describe, it, expect } from "vitest"

import { resolveProviderIconInfo } from "../../src/shared/helpers/providerIconInfo.js"

describe("resolveProviderIconInfo", () => {
  it("returns icon info for built-in provider kr (Kiro)", () => {
    const result = resolveProviderIconInfo("kr")

    expect(result).toEqual({
      fallbackText: "KR",
      fallbackColor: "#FF6B35",
    })
  })

  it("returns icon info for built-in provider glm", () => {
    const result = resolveProviderIconInfo("glm")

    expect(result).toEqual({
      fallbackText: "GL",
      fallbackColor: "#2563EB",
    })
  })

  it("returns OpenAI-compatible chat provider icon with displayName uppercase slice", () => {
    const result = resolveProviderIconInfo("openai-compatible-chat-abc123", "Sumopod")

    expect(result).toEqual({
      fallbackText: "SU",
      fallbackColor: "#10A37F",
    })
  })

  it("returns OpenAI-compatible responses provider icon with displayName uppercase slice", () => {
    const result = resolveProviderIconInfo("openai-compatible-responses-xyz", "MyServer")

    expect(result).toEqual({
      fallbackText: "MY",
      fallbackColor: "#10A37F",
    })
  })

  it("returns Anthropic-compatible provider icon with displayName uppercase slice", () => {
    const result = resolveProviderIconInfo("anthropic-compatible-xyz", "ClaudeProxy")

    expect(result).toEqual({
      fallbackText: "CL",
      fallbackColor: "#D97757",
    })
  })

  it("falls back to provider ID slice when displayName is empty", () => {
    const result = resolveProviderIconInfo("openai-compatible-chat-abc", "")

    expect(result).toEqual({
      fallbackText: "OP",
      fallbackColor: "#10A37F",
    })
  })

  it("does not throw when displayName is null, returns non-empty fallbackText", () => {
    expect(() => resolveProviderIconInfo("anthropic-compatible-xyz", null)).not.toThrow()

    const result = resolveProviderIconInfo("anthropic-compatible-xyz", null)

    expect(result.fallbackText).toBeDefined()
    expect(result.fallbackText.length).toBeGreaterThan(0)
    expect(result.fallbackColor).toBeDefined()
  })

  it("returns generic icon for unknown provider", () => {
    const result = resolveProviderIconInfo("unknown-xyz")

    expect(result).toEqual({
      fallbackText: "UN",
      fallbackColor: "#6b7280",
    })
  })
})
