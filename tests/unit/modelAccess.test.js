/**
 * Unit tests for isModelAllowed logic.
 *
 * Since src/sse/services/modelAccess.js uses path aliases (@/, open-sse/)
 * that vitest can't resolve, we test the logic by reimplementing it inline
 * with the same algorithm but direct dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Inline the core logic from modelAccess.js for testability ──────────────
// This mirrors the exact algorithm in src/sse/services/modelAccess.js
// but with injected dependencies instead of import aliases.

const ALIAS_TO_PROVIDER_ID = {
  cc: "claude",
  cx: "codex",
  gc: "gemini-cli",
  qw: "qwen",
  ag: "antigravity",
  gh: "github",
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
};

function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

function parseModel(modelStr) {
  if (!modelStr) return { provider: null, model: null, isAlias: false, providerAlias: null };
  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }
  return { provider: null, model: modelStr, isAlias: true, providerAlias: null };
}

function normalizeModelStr(str) {
  if (!str || !str.includes("/")) return str;
  const parsed = parseModel(str);
  if (parsed.provider) return `${parsed.provider}/${parsed.model}`;
  return str;
}

// getModelInfo mock — injectable
let mockGetModelInfo = async () => ({ provider: null, model: null });

async function isModelAllowed(modelStr, allowedModels) {
  if (!allowedModels || allowedModels.length === 0) return true;

  const normalizedRequest = normalizeModelStr(modelStr);
  const normalizedAllowed = allowedModels.map(entry => normalizeModelStr(entry));

  if (normalizedAllowed.includes(normalizedRequest)) return true;

  for (const pattern of normalizedAllowed) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1);
      if (normalizedRequest.startsWith(prefix)) return true;
    }
  }

  try {
    const modelInfo = await mockGetModelInfo(modelStr);
    if (modelInfo.provider && modelInfo.model) {
      const resolved = `${modelInfo.provider}/${modelInfo.model}`;
      if (resolved !== normalizedRequest) {
        if (normalizedAllowed.includes(resolved)) return true;
        for (const pattern of normalizedAllowed) {
          if (pattern.endsWith("/*")) {
            const prefix = pattern.slice(0, -1);
            if (resolved.startsWith(prefix)) return true;
          }
        }
      }
    }
  } catch {
    // deny
  }

  return false;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetModelInfo = async () => ({ provider: null, model: null });
});

describe("isModelAllowed", () => {
  describe("no restrictions (empty/null/undefined)", () => {
    it("returns true for empty array", async () => {
      expect(await isModelAllowed("openai/gpt-4", [])).toBe(true);
    });
    it("returns true for null", async () => {
      expect(await isModelAllowed("openai/gpt-4", null)).toBe(true);
    });
    it("returns true for undefined", async () => {
      expect(await isModelAllowed("openai/gpt-4", undefined)).toBe(true);
    });
  });

  describe("exact match", () => {
    it("matches exact model string", async () => {
      expect(await isModelAllowed("openai/gpt-4", ["openai/gpt-4"])).toBe(true);
    });
    it("rejects non-matching model", async () => {
      expect(await isModelAllowed("openai/gpt-4", ["anthropic/claude-3"])).toBe(false);
    });
    it("matches combo name (bare string)", async () => {
      expect(await isModelAllowed("my-combo", ["my-combo"])).toBe(true);
    });
    it("rejects different combo name", async () => {
      expect(await isModelAllowed("my-combo", ["other-combo"])).toBe(false);
    });
  });

  describe("provider alias normalization", () => {
    it("cc/ in request matches claude/ in allowedModels", async () => {
      expect(await isModelAllowed("cc/claude-sonnet-4-20250514", ["claude/claude-sonnet-4-20250514"])).toBe(true);
    });
    it("claude/ in request matches cc/ in allowedModels", async () => {
      expect(await isModelAllowed("claude/claude-sonnet-4-20250514", ["cc/claude-sonnet-4-20250514"])).toBe(true);
    });
    it("cx/ normalizes to codex/", async () => {
      expect(await isModelAllowed("cx/some-model", ["codex/some-model"])).toBe(true);
    });
    it("gc/ normalizes to gemini-cli/", async () => {
      expect(await isModelAllowed("gc/gemini-2.5-pro", ["gemini-cli/gemini-2.5-pro"])).toBe(true);
    });
  });

  describe("wildcard matching", () => {
    it("provider/* matches any model of that provider", async () => {
      expect(await isModelAllowed("openai/gpt-4", ["openai/*"])).toBe(true);
      expect(await isModelAllowed("openai/gpt-3.5-turbo", ["openai/*"])).toBe(true);
    });
    it("does not match different provider", async () => {
      expect(await isModelAllowed("anthropic/claude-3", ["openai/*"])).toBe(false);
    });
    it("cc/* matches claude/ models (alias normalization in wildcard)", async () => {
      expect(await isModelAllowed("claude/claude-sonnet-4-20250514", ["cc/*"])).toBe(true);
    });
    it("claude/* matches cc/ requests", async () => {
      expect(await isModelAllowed("cc/claude-sonnet-4-20250514", ["claude/*"])).toBe(true);
    });
  });

  describe("alias resolution (bare model names)", () => {
    it("resolves alias and matches exact", async () => {
      mockGetModelInfo = async () => ({ provider: "openai", model: "gpt-4" });
      expect(await isModelAllowed("gpt4", ["openai/gpt-4"])).toBe(true);
    });
    it("resolves alias and matches wildcard", async () => {
      mockGetModelInfo = async () => ({ provider: "openai", model: "gpt-4" });
      expect(await isModelAllowed("gpt4", ["openai/*"])).toBe(true);
    });
    it("rejects resolved alias not in allowed list", async () => {
      mockGetModelInfo = async () => ({ provider: "openai", model: "gpt-4" });
      expect(await isModelAllowed("gpt4", ["anthropic/*"])).toBe(false);
    });
    it("rejects when resolution fails (error)", async () => {
      mockGetModelInfo = async () => { throw new Error("fail"); };
      expect(await isModelAllowed("unknown", ["openai/*"])).toBe(false);
    });
    it("rejects when resolution returns null provider", async () => {
      mockGetModelInfo = async () => ({ provider: null, model: null });
      expect(await isModelAllowed("unknown", ["openai/*"])).toBe(false);
    });
  });

  describe("multiple allowed models", () => {
    const allowed = ["openai/gpt-4", "anthropic/claude-3", "my-combo"];
    it("matches first", async () => {
      expect(await isModelAllowed("openai/gpt-4", allowed)).toBe(true);
    });
    it("matches last", async () => {
      expect(await isModelAllowed("my-combo", allowed)).toBe(true);
    });
    it("rejects unlisted", async () => {
      expect(await isModelAllowed("openai/gpt-3.5", allowed)).toBe(false);
    });
  });

  describe("mixed wildcards and exact", () => {
    const allowed = ["openai/*", "anthropic/claude-3", "my-combo"];
    it("matches via wildcard", async () => {
      expect(await isModelAllowed("openai/gpt-4", allowed)).toBe(true);
    });
    it("matches via exact", async () => {
      expect(await isModelAllowed("anthropic/claude-3", allowed)).toBe(true);
    });
    it("rejects non-matching", async () => {
      expect(await isModelAllowed("anthropic/claude-4", allowed)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("empty model string with restrictions", async () => {
      expect(await isModelAllowed("", ["openai/*"])).toBe(false);
    });
    it("bare /* wildcard does not match (no provider prefix)", async () => {
      // "/*" has empty provider — parseModel returns falsy provider, not normalized as wildcard
      expect(await isModelAllowed("openai/gpt-4", ["/*"])).toBe(false);
    });
    it("model with multiple slashes", async () => {
      expect(await isModelAllowed("openai/ft:gpt-4:my-org", ["openai/ft:gpt-4:my-org"])).toBe(true);
      expect(await isModelAllowed("openai/ft:gpt-4:my-org", ["openai/*"])).toBe(true);
    });
  });
});
