import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import OPENCODE_REGISTRY from "open-sse/providers/registry/opencode.js";
import EDGE_TTS_REGISTRY from "open-sse/providers/registry/edge-tts.js";
import {
  getConnectionStatus,
  matchesStatusFilter,
  vendorClientOnlyLabel,
} from "@/app/(dashboard)/dashboard/providers/utils.js";

// DF-9ROUTER-1 — a provider can declare `noAuth: true` and still be unusable
// from 9router's own process: opencode's free tier only answers when the
// request comes from OpenCode's own client. Live probes at HEAD (2026-09-17):
//   GET  /zen/v1/models           -> 200 (the model list looks healthy)
//   POST /zen/v1/responses        -> 403 FreeTierError "OpenCode's free tier
//        can only be used from within OpenCode" (executor's own header set)
//   POST /zen/v1/chat/completions -> 401 "Missing API key."
// The registry therefore carries `requiresVendorClient: true`, and BOTH
// advertisement surfaces (the /v1/models catalog + the dashboard badge) must
// stop claiming the provider is usable on a fresh install.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const ids = (models) => models.map((m) => m.id);

// Positive control for "genuinely credentialless": edge-tts runs a local
// synthesis path and takes no credentials at all, so it must stay advertised.
const CREDENTIALLESS_TTS_MODEL = "edge-tts/en-US-AriaNeural";
const CREDENTIALLESS_TTS_MODEL_SIBLING = "edge-tts/en-US-GuyNeural";
const VENDOR_CLIENT_ONLY_MODELS = [
  "oc/muse-spark-1.2-contributor-free",
  "oc/muse-spark-1.3-contributor-free",
];

describe("provider free-tier honesty (DF-9ROUTER-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("flags opencode as vendor-client-only and leaves genuinely credentialless providers unflagged", () => {
    expect(OPENCODE_REGISTRY.noAuth).toBe(true);
    expect(OPENCODE_REGISTRY.requiresVendorClient).toBe(true);

    // The flag must survive buildProviderEntry — the dashboard page and the
    // models route read AI_PROVIDERS, not the raw registry entry.
    expect(AI_PROVIDERS.opencode?.noAuth).toBe(true);
    expect(AI_PROVIDERS.opencode?.requiresVendorClient).toBe(true);

    expect(EDGE_TTS_REGISTRY.noAuth).toBe(true);
    expect(EDGE_TTS_REGISTRY.requiresVendorClient).toBeUndefined();
    expect(AI_PROVIDERS["edge-tts"]?.noAuth).toBe(true);
    expect(AI_PROVIDERS["edge-tts"]?.requiresVendorClient).toBeUndefined();
  });

  it("hides a vendor-client-only provider's models on a fresh install while keeping other credentialless providers", async () => {
    const llm = ids(await buildModelsList(["llm"]));

    for (const model of VENDOR_CLIENT_ONLY_MODELS) {
      expect(llm).not.toContain(model);
    }
    expect(llm.some((id) => id.startsWith("oc/"))).toBe(false);

    // Credentialless providers of another kind are untouched by the flag, and a
    // custom model on one still surfaces: the filter keys on the flag, it is
    // not a blanket "hide everything" switch.
    const tts = ids(await buildModelsList(["tts"]));
    expect(tts).toContain(CREDENTIALLESS_TTS_MODEL);
    expect(tts).toContain(CREDENTIALLESS_TTS_MODEL_SIBLING);

    mocks.getCustomModels.mockResolvedValue([
      { id: "custom-1", providerAlias: "edge-tts" },
      { id: "custom-2", providerAlias: "oc" },
    ]);
    const withCustom = ids(await buildModelsList(["llm"]));
    expect(withCustom).toContain("edge-tts/custom-1");
    expect(withCustom).not.toContain("oc/custom-2");
  });

  it("still lists a flagged provider's models once a connection is configured", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "opencode", isActive: true },
    ]);

    const llm = ids(await buildModelsList(["llm"]));

    expect(llm).toContain("oc/muse-spark-1.2-contributor-free");
  });

  it("does not report a flagged provider as active without a stored connection", () => {
    const stats = { total: 0, allDisabled: false };

    expect(getConnectionStatus(stats, true, true)).not.toBe("active");
    expect(getConnectionStatus(stats, true, true)).toBe("none");
    expect(matchesStatusFilter("active", stats, true, true)).toBe(false);
    expect(matchesStatusFilter("none", stats, true, true)).toBe(true);

    // Unflagged noAuth providers keep the existing behaviour.
    expect(getConnectionStatus(stats, true)).toBe("active");
    expect(getConnectionStatus(stats, true, false)).toBe("active");
    // An enabled stored connection is still reported as active.
    expect(getConnectionStatus({ total: 1, allDisabled: false }, true, true)).toBe("active");
    expect(getConnectionStatus({ total: 2, allDisabled: true }, true, true)).toBe("inactive");
  });

  it("labels a flagged provider's card honestly instead of the green Ready badge", () => {
    const flagged = AI_PROVIDERS.opencode;
    expect(flagged.requiresVendorClient).toBe(true);

    expect(vendorClientOnlyLabel(flagged.name)).toBe("OpenCode client only");
    expect(vendorClientOnlyLabel("Some Vendor Free Tier")).toBe("Some Vendor client only");
    expect(vendorClientOnlyLabel("Some Vendor")).toBe("Some Vendor client only");
    expect(vendorClientOnlyLabel(undefined)).toBe("Vendor client only");
    // The label must not claim readiness, which is what the card used to show.
    expect(vendorClientOnlyLabel(flagged.name)).not.toMatch(/ready/i);
  });
});
