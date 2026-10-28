import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The combos page showed 128K for nvidia/stepfun-ai/step-5-preview while
// models.dev lists 1,048,576. The window was not wrong anywhere in particular:
// no table covers the model, so the generic `*step-*` row decided, and the
// models.dev overlay could not correct it because the limit half of the
// catalog was only built for models the static registry enumerates — and the
// registry does not list this one (the user added it by hand on nvidia). The
// fix collects limits for every model the gateway lists upstream.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-coverage-"));
process.env.DATA_DIR = dataDir;
const catalogFile = path.join(dataDir, "model-catalog.json");

// nvidia lists 52 models upstream; registry/nvidia.js carries 11 of them.
const upstream = {
  nvidia: {
    models: {
      "stepfun-ai/step-5-preview": {
        modalities: { input: ["text", "image"] },
        limit: { context: 1048576, output: 1048576 },
      },
      "z-ai/glm-5.2": { modalities: { input: ["text"] }, limit: { context: 1000000, output: 128000 } },
      // agrees with the registry snapshot's own resolution: no delta either way
      "nvidia/nemotron-3-ultra-550b-a55b": { modalities: { input: ["text"] }, limit: { context: 1000000, output: 128000 } },
      // the registry declares this window outright
      "nvidia/nv-embedqa-e5-v5": { modalities: { input: ["text"] }, limit: { context: 512, output: 4096 } },
    },
  },
};
// The registry snapshot: the eleven models nvidia.js declares, none of them the
// stepfun id. `current` is what the hand-written tables resolve on their own.
const entries = [
  { provider: "nvidia", model: "minimaxai/minimax-m2.7", current: { contextWindow: 200000, maxOutput: 131072 } },
  { provider: "nvidia", model: "z-ai/glm-5.2", current: { contextWindow: 200000, maxOutput: 128000 } },
  { provider: "nvidia", model: "deepseek-ai/deepseek-v4-pro", current: { contextWindow: 1000000, maxOutput: 65536 } },
  { provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b", current: { contextWindow: 1000000, maxOutput: 128000 } },
  { provider: "nvidia", model: "nvidia/nv-embedqa-e5-v5", contextLength: 512, current: { contextWindow: 512, maxOutput: 512 } },
];

let build, getCatalogModalities, getCatalogLimits, invalidateCatalog, capabilities;

// Resolved before the reader is installed: build() detaches it itself now, but a
// result captured up front is the one the assertions below talk about.
let built;

beforeAll(async () => {
  ({ build } = await import("../../src/lib/modelCatalog/sync.js"));
  ({ getCatalogModalities, invalidateCatalog } = await import("../../open-sse/providers/catalogOverride.js"));
  ({ getCatalogLimits } = await import("../../open-sse/providers/catalogOverride.js"));
  capabilities = await import("../../open-sse/providers/capabilities.js");
  built = build(upstream, entries);
  fs.writeFileSync(catalogFile, JSON.stringify({ v: 2, models: built.models, providers: built.providers }), "utf8");
  invalidateCatalog();
  capabilities.setCatalogSource({
    getModalities: getCatalogModalities,
    getLimits: getCatalogLimits,
  });
});

afterAll(() => {
  capabilities.setCatalogSource(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("model catalog limit coverage", () => {
  it("records the upstream window for a model the registry does not list", () => {
    // keyed by the base id, which is what the reader falls back to
    expect(built.providers.nvidia["step-5-preview"]).toEqual({
      contextWindow: 1048576,
      maxOutput: 1048576,
    });
  });

  it("still records the models the registry does list", () => {
    // glm-5.2 resolves 200000 in the tables and 1000000 upstream
    expect(built.providers.nvidia["glm-5.2"]).toEqual({ contextWindow: 1000000 });
    // nemotron-3-ultra agrees with its snapshot, so nothing is written for it
    expect(built.providers.nvidia["nemotron-3-ultra-550b-a55b"]).toBeUndefined();
  });

  it("resolves the real window through the reader", () => {
    const caps = capabilities.getCapabilitiesForModel("nvidia", "stepfun-ai/step-5-preview");
    // was 128000 from the `*step-*` pattern before the catalog covered it
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(1048576);
  });

  it("leaves a registry-declared window to the registry", () => {
    // contextLength is the gateway's own number; upstream may still correct the
    // output limit, which the declaration says nothing about
    expect(built.providers.nvidia["nv-embedqa-e5-v5"]).toEqual({ maxOutput: 4096 });
  });

  it("does not publish limits for a gateway 9router does not register", () => {
    // a limit replaces a number, so an upstream provider with no local id must
    // not get one from models.dev's view of it
    const other = { chutes: { models: { "some-model": { limit: { context: 7, output: 7 } } } } };
    expect(build(other, entries).providers.chutes).toBeUndefined();
  });

  it("keeps modalities additive for that same unregistered gateway", () => {
    const other = { chutes: { models: { "some-model": { modalities: { input: ["text", "image"] } } } } };
    expect(build(other, entries).models["chutes:some-model"]).toEqual({ vision: true });
  });

  it("reads the tables alone even with the catalog installed", () => {
    // a second run against the same file must produce the same deltas, or the
    // file erases itself: a model already covered reads as "no change"
    expect(build(upstream, entries)).toEqual(built);
  });

  it("takes the last upstream record for limits and the first for modalities", () => {
    // baseId collapses a vendor prefix and a ":free" tier, so two upstream ids
    // can normalize to one model with different windows. The per-entry index
    // this builder replaced kept the last record's limits and the first
    // record's modalities; merging the two passes must not flip either.
    const colliding = {
      openrouter: {
        models: {
          "some-vendor/model-a:free": { modalities: { input: ["text", "image"] }, limit: { context: 65536, output: 8192 } },
          "some-vendor/model-a": { modalities: { input: ["text"] }, limit: { context: 128000, output: 8192 } },
        },
      },
    };
    const withRouter = [...entries, { provider: "openrouter", model: "some-vendor/model-a", current: { contextWindow: 200000, maxOutput: 64000 } }];
    const out = build(colliding, withRouter);
    // limits from the last record, modalities from the first. The snapshot's
    // 200000/64000 disagrees with both records, so both fields carry a delta.
    expect(out.providers.openrouter["model-a"]).toEqual({ contextWindow: 128000, maxOutput: 8192 });
    expect(out.models["openrouter:model-a"]).toEqual({ vision: true });
  });
});
