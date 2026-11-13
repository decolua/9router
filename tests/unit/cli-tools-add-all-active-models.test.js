import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { buildModelGroups, collectModelValues, NO_AUTH_PROVIDER_IDS, LIVE_CATALOG_PROVIDERS, liveModelCaps } from "@/shared/utils/selectableModels.js";

// Regression: "+ Add All Active Models" on /dashboard/cli-tools/pi used to walk the
// static provider registry over connection rows only, so it dropped every model the
// picker could still offer — most visibly OpenCode Free (`oc`), a no-auth provider
// that never owns a connection row and whose usable ids come from /api/models/custom.
describe("buildModelGroups / collectModelValues for Add All Active Models", () => {
  it("includes a no-auth free provider that has no connection row", () => {
    expect(NO_AUTH_PROVIDER_IDS).toContain("opencode");

    const values = collectModelValues(
      buildModelGroups({
        connections: [],
        allConnections: [],
        modelAliases: {},
        customModels: [],
        disabledModels: {},
      })
    );

    // Static registry entries for OpenCode Free must survive with zero connections.
    // (jev-1.13-free is kind: "systemone", so the LLM view hides it — picker parity.)
    expect(values).toContain("oc/union-alpha");
    expect(values).toContain("oc/muse-spark-1.2-contributor-free");
    expect(values).not.toContain("oc/jev-1.13-free");
  });

  it("includes custom models registered under the provider alias", () => {
    const customModels = [
      { providerAlias: "oc", id: "big-pickle", type: "llm", name: "big-pickle" },
      { providerAlias: "oc", id: "glm-5.3-flash-free", type: "llm", name: "glm-5.3-flash-free" },
    ];

    const values = collectModelValues(
      buildModelGroups({ connections: [], allConnections: [], modelAliases: {}, customModels, disabledModels: {} })
    );

    expect(values).toContain("oc/big-pickle");
    expect(values).toContain("oc/glm-5.3-flash-free");
  });

  it("includes user aliases for a passthrough provider", () => {
    const values = collectModelValues(
      buildModelGroups({
        connections: [],
        allConnections: [],
        modelAliases: { "oc/beam-free": "oc/beam-free" },
        customModels: [],
        disabledModels: {},
      })
    );

    expect(values).toContain("oc/beam-free");
  });

  it("skips models disabled for the provider", () => {
    const values = collectModelValues(
      buildModelGroups({
        connections: [],
        allConnections: [],
        modelAliases: {},
        customModels: [{ providerAlias: "oc", id: "big-pickle", type: "llm" }],
        disabledModels: { oc: ["big-pickle", "union-alpha"] },
      })
    );

    expect(values).not.toContain("oc/big-pickle");
    expect(values).not.toContain("oc/union-alpha");
    expect(values).toContain("oc/muse-spark-1.2-contributor-free");
  });

  it("routes connections through their provider alias", () => {
    const values = collectModelValues(
      buildModelGroups({
        connections: [{ id: "c1", provider: "opencode", isActive: true }],
        allConnections: [{ id: "c1", provider: "opencode", isActive: true }],
        modelAliases: {},
        customModels: [],
        disabledModels: {},
      })
    );

    // No-auth providers are always offered, so assert the connection's own models
    // resolve under the routing alias rather than that they are the only entries.
    expect(values).toContain("oc/muse-spark-1.2-contributor-free");
    expect(values).toContain("oc/union-alpha");
    expect(values.filter((value) => value.startsWith("oc/")).length).toBeGreaterThan(1);
  });

  it("drops providers whose connections are all deactivated", () => {
    const values = collectModelValues(
      buildModelGroups({
        connections: [],
        allConnections: [{ id: "c1", provider: "gemini", isActive: false }],
        modelAliases: {},
        customModels: [],
        disabledModels: {},
      })
    );

    expect(values.some((value) => value.startsWith("gemini/"))).toBe(false);
  });

  it("returns unique values only", () => {
    const customModels = [
      { providerAlias: "oc", id: "jev-1.13-free", type: "llm" },
      { providerAlias: "oc", id: "jev-1.13-free", type: "llm" },
    ];
    const values = collectModelValues(
      buildModelGroups({ connections: [], allConnections: [], modelAliases: {}, customModels, disabledModels: {} })
    );

    expect(values.filter((value) => value === "oc/jev-1.13-free")).toHaveLength(1);
  });

  it("tolerates empty and missing inputs", () => {
    expect(collectModelValues(buildModelGroups())).toEqual(expect.any(Array));
    expect(collectModelValues({})).toEqual([]);
  });
});

describe("Add All Active Models uses the shared resolver", () => {
  const cardSrc = fs.readFileSync(
    new URL("../../src/app/(dashboard)/dashboard/cli-tools/components/GenericCliToolCard.js", import.meta.url),
    "utf-8"
  );

  it("pi card resolves targets through buildModelGroups/collectModelValues", () => {
    expect(cardSrc).toContain("buildModelGroups");
    expect(cardSrc).toContain("collectModelValues");
    expect(cardSrc).toContain("/api/models/custom");
  });

  it("pi card no longer derives targets from the static registry alone", () => {
    expect(cardSrc).not.toMatch(/getModelsByProviderId\(conn\.provider\)/);
  });

  it("Add All is not gated on having a connection (no-auth providers need none)", () => {
    expect(cardSrc).not.toMatch(/\{activeProviders\?\.length > 0 && \(\s*<Button[\s\S]{0,200}handleAddAllActiveModels/);
  });

  it("is not registered as a source-only no-op: the button resolves at click time", () => {
    expect(cardSrc).toMatch(/const handleAddAllActiveModels = async \(\)/);
    expect(cardSrc).toContain("/api/models/disabled");
  });
});

// Regression: the CLI-tool pickers only asked for live catalogs of cursor/cline/
// clinepass/zed, while /api/providers/[id]/models also serves claude and
// commandcode. Every commandcode model was therefore unreachable from the cards
// and from "+ Add All Active Models", even though the provider page listed it:
// /api/models is built from the static registry plus custom models, and a live
// per-account catalog is neither.
describe("live per-account catalogs", () => {
  const commandcode = [
    {
      id: "deepseek/deepseek-v4.1-flash-fast",
      name: "DeepSeek V4.1 Flash Fast (latest)",
      contextLength: 1000000,
      isVL: true,
      isReasoning: true,
    },
  ];

  it("asks for commandcode and claude as well", () => {
    expect(LIVE_CATALOG_PROVIDERS).toEqual(
      expect.arrayContaining(["cursor", "cline", "clinepass", "zed", "claude", "commandcode"])
    );
  });

  it("surfaces a commandcode model under its alias", () => {
    const groups = buildModelGroups({
      connections: [{ id: "conn-1", provider: "commandcode", isActive: true }],
      allConnections: [{ id: "conn-1", provider: "commandcode", isActive: true }],
      modelAliases: {},
      customModels: [],
      disabledModels: {},
      liveModels: { commandcode },
    });

    const values = collectModelValues(groups);
    expect(values).toContain("cmc/deepseek/deepseek-v4.1-flash-fast");

    const row = groups.commandcode.models.find((m) => m.id === "deepseek/deepseek-v4.1-flash-fast");
    expect(row.caps).toEqual({ vision: true, reasoning: true, contextWindow: 1000000, maxOutput: undefined });
  });

  it("keeps providers whose catalog rows carry no capability fields", () => {
    const values = collectModelValues(
      buildModelGroups({
        connections: [{ id: "conn-2", provider: "zed", isActive: true }],
        allConnections: [{ id: "conn-2", provider: "zed", isActive: true }],
        modelAliases: {},
        customModels: [],
        disabledModels: {},
        liveModels: { zed: [{ id: "zed-model", name: "Zed Model" }] },
      })
    );

    expect(values).toContain("zd/zed-model");
    expect(liveModelCaps({ id: "zed-model", name: "Zed Model" })).toBeUndefined();
  });
});

describe("live rows carry the provider's capability data through to caps", () => {
  it("passes thinking_levels on, so a card can map real levels", () => {
    const groups = buildModelGroups({
      connections: [{ id: "c1", provider: "commandcode", isActive: true }],
      allConnections: [{ id: "c1", provider: "commandcode", isActive: true }],
      liveModels: {
        commandcode: [
          {
            id: "deepseek/deepseek-v4.1-flash-fast",
            name: "DeepSeek V4.1 Flash Fast",
            contextLength: 1000000,
            isVL: true,
            isReasoning: true,
            thinking_levels: ["none", "low", "high", "max"],
          },
        ],
      },
    });

    const row = groups.commandcode.models.find((m) => m.value === "cmc/deepseek/deepseek-v4.1-flash-fast");
    expect(row.caps.thinking_levels).toEqual(["none", "low", "high", "max"]);
  });

  it("reports caps for a row that only carries levels", () => {
    expect(liveModelCaps({ id: "m", thinking_levels: ["low", "high"] })).toEqual({
      vision: false,
      reasoning: false,
      contextWindow: undefined,
      maxOutput: undefined,
      thinking_levels: ["low", "high"],
    });
  });
});
