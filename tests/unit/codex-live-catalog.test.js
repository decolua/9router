import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ connections: [], customModels: [] }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => store.connections,
  getCombos: async () => [],
  getCustomModels: async () => store.customModels,
  getModelAliases: async () => ({}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));

import { buildModelsList } from "@/app/api/v1/models/route.js";
import { GET as getModelInfo } from "@/app/api/v1/models/info/route.js";

const catalog = {
  models: [
    { slug: "synthetic-alpha", display_name: "Synthetic Alpha", visibility: "list", context_window: 12000, max_context_window: 48000 },
    { slug: "synthetic-gamma", display_name: "Synthetic Gamma", visibility: "list", context_window: 12000, max_context_window: 12000 },
    { slug: "codex-auto-review", display_name: "Auto Review", visibility: "hide", context_window: 12000 },
  ],
};

let nextConn = 0;
function codexConnection() {
  return { id: `codex-test-${++nextConn}`, provider: "codex", isActive: true, accessToken: "test-token", providerSpecificData: { chatgptAccountId: "test-account" } };
}

afterEach(() => { store.connections = []; store.customModels = []; vi.restoreAllMocks(); });

describe("Codex OAuth public model discovery", () => {
  it("resolves canonical metadata when all accounts use custom prefixes", async () => {
    store.connections = [{ ...codexConnection(), providerSpecificData: { prefix: "mycx" } }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(catalog));
    const canonical = await getModelInfo(new Request("http://localhost/v1/models/info?id=codex/synthetic-alpha"));
    const short = await getModelInfo(new Request("http://localhost/v1/models/info?id=cx/synthetic-alpha"));
    const custom = await getModelInfo(new Request("http://localhost/v1/models/info?id=mycx/synthetic-alpha"));
    expect(canonical.status).toBe(200);
    expect(short.status).toBe(200);
    expect((await canonical.json()).context_length).toBe((await custom.json()).context_length);
  });
  it("fails closed with backoff when every account discovery fails", async () => {
    store.connections = [codexConnection(), codexConnection()];
    store.customModels = [{ providerAlias: "cx", id: "synthetic-custom" }];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 503 }));
    expect(await buildModelsList(["llm"])).toEqual([]);
    expect(await buildModelsList(["llm"])).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never advertises static Codex models without an active account", async () => {
    expect((await buildModelsList(["llm"])).filter((m) => m.owned_by === "cx")).toEqual([]);
  });
  it("does not treat custom prefixes as account-routing constraints", async () => {
    store.connections = [codexConnection(), { ...codexConnection(), providerSpecificData: { prefix: "mycx" } }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_, opts) => Response.json({ models: [{
      slug: opts.headers["ChatGPT-Account-ID"] ? "synthetic-a" : "synthetic-b", context_window: 12000,
    }] }));
    expect(await buildModelsList(["llm"])).toEqual([]);
  });
  it("resolves the canonical codex alias to the same metadata as cx", async () => {
    store.connections = [codexConnection()];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(catalog));
    const canonical = await getModelInfo(new Request("http://localhost/v1/models/info?id=codex/synthetic-alpha"));
    const short = await getModelInfo(new Request("http://localhost/v1/models/info?id=cx/synthetic-alpha"));
    expect(canonical.status).toBe(200);
    expect(await canonical.json()).toEqual(await short.json());
  });
  it("omits an optional maximum missing on any account regardless of order", async () => {
    for (const reverse of [false, true]) {
      const first = codexConnection();
      const second = codexConnection();
      store.connections = reverse ? [second, first] : [first, second];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_, options) => Response.json({ models: [{
        slug: "synthetic-model", context_window: 12000,
        ...(options.headers.Authorization === `Bearer ${first.id}` ? { max_context_window: 48000 } : {}),
      }] }));
      first.accessToken = first.id;
      second.accessToken = second.id;
      const models = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "cx");
      expect(models).toHaveLength(2);
      expect(models.every((m) => !("max_context_window" in m))).toBe(true);
    }
  });
  it("uses the account's current catalog instead of advertising unsupported static models", async () => {
    store.connections = [codexConnection()];
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(catalog));
    const models = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "cx");

    expect(fetcher).toHaveBeenCalled();
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("client_version")).not.toBe("0.144.6");
    expect(models.map((m) => m.id).sort()).toEqual([
      "cx/codex-auto-review", "cx/synthetic-alpha", "cx/synthetic-alpha-review", "cx/synthetic-gamma", "cx/synthetic-gamma-review",
    ]);
    expect(models.every((m) => m.context_length === 12000 && m.capabilities.contextWindow === 12000)).toBe(true);
  });

  it("does not resurrect manually added IDs excluded by the live account catalog", async () => {
    store.connections = [codexConnection()];
    store.customModels = [{ providerAlias: "cx", id: "retired-custom", type: "llm" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(catalog));
    const models = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "cx");
    expect(models.map((m) => m.id)).not.toContain("cx/retired-custom");
  });

  it("does not advertise static entries when the authenticated account has no models", async () => {
    store.connections = [codexConnection()];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ models: [] }));
    expect((await buildModelsList(["llm"])).filter((m) => m.owned_by === "cx")).toEqual([]);
  });

  it("advertises only models supported by every active Codex account", async () => {
    const first = codexConnection();
    const second = { ...codexConnection(), providerSpecificData: { chatgptAccountId: "other-account" } };
    store.connections = [first, second];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_, opts) => Response.json({ models: [
      { slug: opts.headers["ChatGPT-Account-ID"] === "test-account" ? "synthetic-alpha" : "synthetic-beta", visibility: "list", context_window: 12000 },
    ] }));
    const models = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "cx");
    expect(models).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns metadata for a custom Codex prefix", async () => {
    store.connections = [{ ...codexConnection(), providerSpecificData: { prefix: "mycx", chatgptAccountId: "test-account" } }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(catalog));
    const info = await getModelInfo(new Request("http://localhost/v1/models/info?id=mycx/synthetic-alpha"));
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ id: "mycx/synthetic-alpha", context_length: 12000 });
  });

  it("preserves the routable Codex auto-review virtual model", async () => {
    store.connections = [codexConnection()];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(catalog));
    const info = await getModelInfo(new Request("http://localhost/v1/models/info?id=cx/codex-auto-review"));
    expect(info.status).toBe(200);
  });

  it("reuses a recent account catalog instead of fetching upstream for every model-list request", async () => {
    store.connections = [codexConnection()];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(catalog));
    await buildModelsList(["llm"]);
    await buildModelsList(["llm"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not accept a stale 0.0.0 catalog after modern discovery fails", async () => {
    store.connections = [codexConnection()];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("client_version=0.0.0")) return Response.json({ models: [{ slug: "stale", context_window: 1 }] });
      return new Response("unavailable", { status: 503 });
    });
    const models = (await buildModelsList(["llm"])).filter((m) => m.owned_by === "cx");
    expect(models.map((m) => m.id)).not.toContain("cx/stale");
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("client_version=0.0.0"))).toBe(true);
  });

  it("returns current Codex context through the model-info endpoint, not stale registry values", async () => {
    store.connections = [codexConnection()];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(catalog));
    const info = await getModelInfo(new Request("http://localhost/v1/models/info?id=cx/synthetic-alpha"));
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ id: "cx/synthetic-alpha", context_length: 12000, max_context_window: 48000 });
    const unsupported = await getModelInfo(new Request("http://localhost/v1/models/info?id=cx/gpt-5.4-mini"));
    expect(unsupported.status).toBe(404);
  });
});
