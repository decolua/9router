// T3.4 (T-D): models.dev lifecycle status must survive slim() -> catalog file
// -> getCatalogLifecycle, and the ETag/304 path must not lose the field.
import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DATA_DIR is resolved at module-import time by both the writer (sync.js via
// catalogOverride) and the reader — so the scratch dir must be set before any
// import of the repo modules. vi.hoisted runs above the transformed imports
// (no imported bindings are available inside it; dataDir.js mkdir -ps the
// configured path itself, so a plain string is enough).
const scratch = vi.hoisted(() => {
  const prev = process.env.DATA_DIR;
  const dir = `/tmp/t34-catalog-${process.pid}-${Date.now()}`;
  process.env.DATA_DIR = dir;
  return { dir, prev };
});

import {
  CATALOG_FILE,
  CATALOG_RAW_FILE,
  __setCatalogCacheForTests,
  getCatalogLifecycle,
  invalidateCatalog,
  normalizeLifecycleStatus,
} from "../../open-sse/providers/catalogOverride.js";
import { slim, buildLifecycle, syncModelCatalog } from "../../src/lib/modelCatalog/sync.js";

afterAll(() => {
  if (scratch.prev === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = scratch.prev;
  try { fs.rmSync(scratch.dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// Fixture mirroring the models.dev api.json shape. Statuses exercise the real
// observed vocabulary (deprecated, beta, alpha per the zod schema) plus the
// retired synonyms the normalizer folds in — models.dev expresses hard EOL
// today by removing the entry, so `retired` is forward-compatible signal.
const fixture = () => ({
  anthropic: {
    models: {
      "claude-3-opus": { modalities: { input: ["text"] }, limit: { context: 200000, output: 4096 }, status: "EOL" },
      "claude-2": { modalities: { input: ["text"] }, limit: { context: 100000, output: 4096 }, status: "retired" },
      "claude-sonnet-4": { modalities: { input: ["text", "image"] }, limit: { context: 200000, output: 64000 } },
    },
  },
  openai: {
    models: {
      "gpt-4o": { modalities: { input: ["text", "image"] }, limit: { context: 128000, output: 16384 }, status: "deprecated" },
      "gpt-5-mini": { modalities: { input: ["text"] }, limit: { context: 400000, output: 128000 }, status: "alpha" },
      "gpt-current": { modalities: { input: ["text"] }, limit: { context: 400000, output: 128000 } },
    },
  },
  openrouter: {
    models: {
      "meta/llama-4-maverick": { modalities: { input: ["text"] }, limit: { context: 128000, output: 16384 }, status: "beta" },
    },
  },
  "alibaba-coding-plan": {
    models: { "xx-model": { status: "deprecated" } },
  },
  "alibaba-coding-plan-cn": {
    // Same base id, harsher status: the merge must keep the most advanced.
    models: { "xx-model": { status: "shutdown" } },
  },
  zetai: { models: { "z-model": { status: "deprecated" } } },
});

describe("slim() captures model.status (T-D anchor)", () => {
  it("keeps the raw status under `st`", () => {
    const s = slim(fixture());
    expect(s.anthropic["claude-3-opus"].st).toBe("EOL");
    expect(s.openai["gpt-4o"].st).toBe("deprecated");
    expect(s.openai["gpt-5-mini"].st).toBe("alpha");
    expect(s.openrouter["meta/llama-4-maverick"].st).toBe("beta");
  });

  it("drops `st` (and stays JSON-clean) for models without a status", () => {
    const s = slim(fixture());
    expect(s.anthropic["claude-sonnet-4"].st).toBeUndefined();
    const serialized = JSON.parse(JSON.stringify(s));
    expect("st" in serialized.anthropic["claude-sonnet-4"]).toBe(false);
    expect(serialized.anthropic["claude-3-opus"].st).toBe("EOL");
  });

  it("tolerates models with no fields at all", () => {
    expect(() => slim({ p: { models: { m: {} } } })).not.toThrow();
  });
});

describe("buildLifecycle", () => {
  it("indexes only status-carrying models, keyed for the reader", () => {
    const lc = buildLifecycle(fixture());
    expect(lc.anthropic["claude-3-opus"]).toBe("EOL");
    // PROVIDER_ALIASES (claude -> anthropic): the row is mirrored under the 9router id.
    expect(lc.claude["claude-3-opus"]).toBe("EOL");
    expect(lc.openai["gpt-4o"]).toBe("deprecated");
    expect(lc.openai["gpt-5-mini"]).toBe("alpha");
    expect(lc.openrouter["llama-4-maverick"]).toBe("beta"); // baseId key, vendor prefix stripped
    // Unmapped models.dev providers stay indexed under their own id.
    expect(lc.zetai["z-model"]).toBe("deprecated");
    // No status -> no row -> the whole bucket for a clean provider is absent.
    expect(lc.anthropic["claude-sonnet-4"]).toBeUndefined();
  });

  it("mirrors COST_PROVIDERS upstreams and keeps the harshest status", () => {
    const lc = buildLifecycle(fixture());
    // alicode -> ["alibaba-coding-plan-cn", "alibaba-coding-plan"]
    expect(lc.alicode["xx-model"]).toBe("shutdown");
  });

  it("returns an empty map for a feed with no statuses", () => {
    expect(buildLifecycle({ p: { models: { m: { limit: {} } } } })).toEqual({});
  });
});

describe("normalizeLifecycleStatus", () => {
  it("folds the retired/EOL synonyms", () => {
    for (const raw of ["retired", "EOL", "end-of-life", "shutdown", "sunset", " Retired "]) {
      expect(normalizeLifecycleStatus(raw)).toBe("retired");
    }
  });
  it("keeps the deprecation/prerelease classes distinct", () => {
    expect(normalizeLifecycleStatus("Deprecated")).toBe("deprecated");
    expect(normalizeLifecycleStatus("alpha")).toBe("alpha");
    expect(normalizeLifecycleStatus("beta")).toBe("beta");
    expect(normalizeLifecycleStatus("experimental")).toBe("alpha");
  });
  it("passes unknown future vocabulary through, lowercased — it can only annotate", () => {
    expect(normalizeLifecycleStatus("Frozen")).toBe("frozen");
  });
  it("treats missing/empty/non-string as no signal", () => {
    expect(normalizeLifecycleStatus(undefined)).toBeNull();
    expect(normalizeLifecycleStatus("")).toBeNull();
    expect(normalizeLifecycleStatus(42)).toBeNull();
  });
});

describe("sync -> file -> getCatalogLifecycle round trip", () => {
  const ETAG = "W/t34-lifecycle";

  function installFetch() {
    globalThis.fetch = vi.fn(async (_url, opts) => {
      if (opts?.headers?.["if-none-match"] === ETAG) return { status: 304, ok: false, headers: { get: () => null } };
      return {
        status: 200,
        ok: true,
        headers: { get: (k) => (String(k).toLowerCase() === "etag" ? ETAG : null) },
        json: async () => fixture(),
      };
    });
  }

  it("writes the lifecycle section and reads it back through the same API as costs", async () => {
    installFetch();
    const result = await syncModelCatalog();
    expect(result?.status).toBe("updated");

    const file = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    expect(file.v).toBe(1); // file format unchanged: new sibling section only
    expect(file.lifecycle.claude["claude-3-opus"]).toBe("EOL");
    expect(file.lifecycle.openai["gpt-4o"]).toBe("deprecated");

    const raw = JSON.parse(fs.readFileSync(CATALOG_RAW_FILE, "utf8"));
    expect(raw.anthropic["claude-3-opus"].st).toBe("EOL");

    // True round trip: real reader re-reading the real file, no cache injection.
    invalidateCatalog();
    expect(getCatalogLifecycle("claude", "claude-3-opus")).toBe("retired");
    expect(getCatalogLifecycle("openai", "gpt-4o")).toBe("deprecated");
    expect(getCatalogLifecycle("openai", "gpt-5-mini")).toBe("alpha");
    // Universal fallback like getCatalogCost: another reseller falls to openrouter.
    expect(getCatalogLifecycle("orcarouter", "llama-4-maverick")).toBe("beta");
    expect(getCatalogLifecycle("openai", "gpt-current")).toBeNull();
  }, 30000);

  it("an ETag/304 (unchanged) sync keeps the lifecycle field", async () => {
    installFetch();
    const before = fs.readFileSync(CATALOG_FILE, "utf8");
    const result = await syncModelCatalog();
    expect(result?.status).toBe("unchanged");
    // The 304 request carried the stored etag and the file was not rewritten.
    expect(globalThis.fetch.mock.calls[0][1].headers["if-none-match"]).toBe(ETAG);
    expect(fs.readFileSync(CATALOG_FILE, "utf8")).toBe(before);

    invalidateCatalog();
    expect(getCatalogLifecycle("claude", "claude-3-opus")).toBe("retired");
    expect(getCatalogLifecycle("anthropic", "claude-2")).toBe("retired");
  }, 30000);
});

describe("getCatalogLifecycle reader", () => {
  it("survives a pre-lifecycle catalog file (no section -> no signal)", () => {
    invalidateCatalog();
    __setCatalogCacheForTests({ models: {}, providers: {}, costs: { openrouter: {} } });
    expect(getCatalogLifecycle("claude", "anything")).toBeNull();
  });

  it("normalizes on read and matches by exact id first, then base id", () => {
    __setCatalogCacheForTests({
      lifecycle: {
        openai: { "gpt-4o": "shutdown", "vendor/GPT-4o-2024": "deprecated" },
        openrouter: { "fallback-model": "end-of-life" },
      },
    });
    expect(getCatalogLifecycle("openai", "gpt-4o")).toBe("retired");
    expect(getCatalogLifecycle("openai", "vendor/GPT-4o-2024")).toBe("deprecated");
    expect(getCatalogLifecycle("openai", "GPT-4o")).toBe("retired"); // baseId lowercases
    expect(getCatalogLifecycle("orcarouter", "fallback-model")).toBe("retired");
    expect(getCatalogLifecycle("openrouter", "fallback-model")).toBe("retired");
  });

  it("returns null without provider or model", () => {
    __setCatalogCacheForTests({ lifecycle: { openai: { "gpt-4o": "retired" } } });
    expect(getCatalogLifecycle(null, "gpt-4o")).toBeNull();
    expect(getCatalogLifecycle("openai", undefined)).toBeNull();
  });
});
