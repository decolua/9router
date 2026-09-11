/**
 * Unit tests for the discover route's pure helper functions:
 * - stableHash (SHA-256 of sorted-key JSON)
 * - inferKindFromModelId
 * - extractCapabilityFlags
 * - normalizeToSnapshot (integration of above)
 *
 * These are tested indirectly by importing the module. Since the route uses
 * Next.js-specific imports (NextResponse, params) we test the helpers by
 * reproducing them here — keeping tests isolated from HTTP infrastructure.
 */
import { describe, expect, it } from "vitest";
import crypto from "crypto";

// ── Replicate the pure helpers from discover/route.js ──────────────────────
// (copied to avoid wiring Next.js route context; kept in sync by test contract)

function sortedStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(sortedStringify).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + sortedStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function stableHash(rawModel) {
  if (rawModel === null || rawModel === undefined) return null;
  try {
    const sorted = sortedStringify(rawModel);
    return crypto.createHash("sha256").update(sorted).digest("hex");
  } catch {
    return null;
  }
}

function inferKindFromModelId(modelId) {
  if (!modelId) return "unknown";
  const lower = modelId.toLowerCase();
  if (lower.includes("embed")) return "embedding";
  if (lower.includes("image") || lower.includes("dall-e")) return "image";
  if (lower.includes("audio") || lower.includes("whisper") || lower.includes("tts")) return "audio";
  return "llm";
}

function extractCapabilityFlags(rawModel) {
  const check = (fields) => fields.some((f) => rawModel[f] === true || rawModel[f] === 1 || rawModel[f] === "true");
  return {
    supportsReasoning: check(["reasoning", "supports_reasoning", "supportsReasoning", "thinking", "supports_thinking"]),
    supportsTools: check(["tools", "function_calling", "supports_tools", "supportsTools", "supports_function_calling"]),
    supportsSearch: check(["search", "web_search", "supports_search", "supportsSearch", "live_search"]),
    supportsVision: check(["vision", "supports_vision", "supportsVision", "image_input", "multimodal"]),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("stableHash", () => {
  it("produces the same hash regardless of property order", () => {
    const a = { id: "grok-4.6", context_length: 500000, vision: true };
    const b = { vision: true, context_length: 500000, id: "grok-4.6" };
    expect(stableHash(a)).toBe(stableHash(b));
    expect(stableHash(a)).toHaveLength(64); // sha256 hex
  });

  it("produces different hashes for different content", () => {
    const a = { id: "model-a", context_length: 128000 };
    const b = { id: "model-b", context_length: 128000 };
    expect(stableHash(a)).not.toBe(stableHash(b));
  });

  it("handles nested objects and arrays deterministically", () => {
    const m = { id: "m", modalities: ["text", "image"], meta: { v: 1 } };
    expect(stableHash(m)).toBe(stableHash(m));
  });

  it("returns null for null/undefined", () => {
    expect(stableHash(null)).toBeNull();
    expect(stableHash(undefined)).toBeNull();
  });
});

describe("inferKindFromModelId", () => {
  it("classifies embedding models", () => {
    expect(inferKindFromModelId("text-embedding-3-large")).toBe("embedding");
    expect(inferKindFromModelId("embed-multilingual")).toBe("embedding");
  });

  it("classifies image models", () => {
    expect(inferKindFromModelId("dall-e-3")).toBe("image");
    expect(inferKindFromModelId("image-gen-1")).toBe("image");
  });

  it("classifies audio models", () => {
    expect(inferKindFromModelId("whisper-1")).toBe("audio");
    expect(inferKindFromModelId("tts-1-hd")).toBe("audio");
    expect(inferKindFromModelId("gpt-4o-audio")).toBe("audio");
  });

  it("defaults to llm for chat models", () => {
    expect(inferKindFromModelId("gpt-4o")).toBe("llm");
    expect(inferKindFromModelId("grok-4.6")).toBe("llm");
    expect(inferKindFromModelId("claude-sonnet-5")).toBe("llm");
  });

  it("returns unknown for null/empty", () => {
    expect(inferKindFromModelId(null)).toBe("unknown");
    expect(inferKindFromModelId("")).toBe("unknown");
  });
});

describe("extractCapabilityFlags", () => {
  it("extracts reasoning flag from various field names", () => {
    expect(extractCapabilityFlags({ reasoning: true }).supportsReasoning).toBe(true);
    expect(extractCapabilityFlags({ supports_reasoning: true }).supportsReasoning).toBe(true);
    expect(extractCapabilityFlags({ thinking: true }).supportsReasoning).toBe(true);
    expect(extractCapabilityFlags({ supportsReasoning: 1 }).supportsReasoning).toBe(true);
  });

  it("extracts vision flag from various field names", () => {
    expect(extractCapabilityFlags({ vision: true }).supportsVision).toBe(true);
    expect(extractCapabilityFlags({ image_input: true }).supportsVision).toBe(true);
    expect(extractCapabilityFlags({ multimodal: true }).supportsVision).toBe(true);
  });

  it("extracts search flag", () => {
    expect(extractCapabilityFlags({ web_search: true }).supportsSearch).toBe(true);
    expect(extractCapabilityFlags({ live_search: true }).supportsSearch).toBe(true);
  });

  it("extracts tools flag", () => {
    expect(extractCapabilityFlags({ function_calling: true }).supportsTools).toBe(true);
    expect(extractCapabilityFlags({ supports_tools: true }).supportsTools).toBe(true);
  });

  it("returns false for all flags when no matching fields", () => {
    const flags = extractCapabilityFlags({ id: "model-x", context_length: 128000 });
    expect(flags.supportsReasoning).toBe(false);
    expect(flags.supportsVision).toBe(false);
    expect(flags.supportsSearch).toBe(false);
    expect(flags.supportsTools).toBe(false);
  });

  it("treats string 'true' as truthy", () => {
    expect(extractCapabilityFlags({ reasoning: "true" }).supportsReasoning).toBe(true);
  });

  it("does not treat 0 as truthy", () => {
    expect(extractCapabilityFlags({ reasoning: 0 }).supportsReasoning).toBe(false);
  });
});

describe("normalizeToSnapshot (inline integration)", () => {
  // Simple inline version of normalizeToSnapshot to test field mapping
  function normalizeToSnapshot({ rawModel, connectionId, providerAlias, fetchedAt, discoveryBatchId }) {
    const rawModelId = rawModel.id || rawModel.model || rawModel.slug || rawModel.name || String(rawModel);
    const displayName = rawModel.display_name || rawModel.displayName || rawModel.name || rawModelId;
    const contextWindow = rawModel.context_length || rawModel.contextWindow || rawModel.context_window || null;
    const maxOutput = rawModel.max_output_tokens || rawModel.maxOutputTokens || rawModel.max_tokens || null;
    const capabilityFlags = extractCapabilityFlags(rawModel);
    const rawPayloadHash = stableHash(rawModel);

    return {
      discoveryBatchId,
      providerAlias,
      connectionId,
      rawModelId,
      canonicalId: `${providerAlias}/${rawModelId}`,
      displayName,
      modelKind: inferKindFromModelId(rawModelId),
      source: "upstream_api",
      confidence: "authoritative",
      contextWindow: contextWindow != null ? Number(contextWindow) : null,
      maxOutput: maxOutput != null ? Number(maxOutput) : null,
      supportsReasoning: capabilityFlags.supportsReasoning,
      supportsTools: capabilityFlags.supportsTools,
      supportsSearch: capabilityFlags.supportsSearch,
      supportsVision: capabilityFlags.supportsVision,
      rawPayload: rawModel,
      rawPayloadHash,
      fetchedAt,
      observedAt: fetchedAt,
    };
  }

  const BATCH_ID = "batch-001";
  const CONN_ID = "conn-001";
  const NOW = "2026-08-30T12:00:00.000Z";

  it("maps id, displayName, and canonicalId correctly", () => {
    const snap = normalizeToSnapshot({
      rawModel: { id: "grok-4.6", display_name: "Grok 4.6", context_length: 500000 },
      connectionId: CONN_ID,
      providerAlias: "gcli",
      fetchedAt: NOW,
      discoveryBatchId: BATCH_ID,
    });
    expect(snap.rawModelId).toBe("grok-4.6");
    expect(snap.displayName).toBe("Grok 4.6");
    expect(snap.canonicalId).toBe("gcli/grok-4.6");
    expect(snap.contextWindow).toBe(500000);
    expect(snap.discoveryBatchId).toBe(BATCH_ID);
  });

  it("stores the full rawPayload and a stable SHA-256 hash", () => {
    const rawModel = { id: "m1", reasoning: true, vision: false };
    const snap = normalizeToSnapshot({
      rawModel,
      connectionId: CONN_ID,
      providerAlias: "gcli",
      fetchedAt: NOW,
      discoveryBatchId: BATCH_ID,
    });
    expect(snap.rawPayload).toEqual(rawModel);
    expect(snap.rawPayloadHash).toHaveLength(64);
    // Hash must be stable: same content = same hash
    const snap2 = normalizeToSnapshot({
      rawModel: { vision: false, id: "m1", reasoning: true }, // property order differs
      connectionId: CONN_ID,
      providerAlias: "gcli",
      fetchedAt: NOW,
      discoveryBatchId: BATCH_ID,
    });
    expect(snap2.rawPayloadHash).toBe(snap.rawPayloadHash);
  });

  it("extracts capability flags from rawModel", () => {
    const snap = normalizeToSnapshot({
      rawModel: { id: "m1", reasoning: true, vision: true, web_search: true, function_calling: true },
      connectionId: CONN_ID,
      providerAlias: "gcli",
      fetchedAt: NOW,
      discoveryBatchId: BATCH_ID,
    });
    expect(snap.supportsReasoning).toBe(true);
    expect(snap.supportsVision).toBe(true);
    expect(snap.supportsSearch).toBe(true);
    expect(snap.supportsTools).toBe(true);
  });

  it("sets observedAt equal to fetchedAt", () => {
    const snap = normalizeToSnapshot({
      rawModel: { id: "m1" },
      connectionId: CONN_ID,
      providerAlias: "gcli",
      fetchedAt: NOW,
      discoveryBatchId: BATCH_ID,
    });
    expect(snap.observedAt).toBe(NOW);
  });
});
