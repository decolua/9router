/**
 * Locks the two fixes that made the proxy pool and the model on/off switch
 * actually take effect at request time:
 *
 *  - `strictProxy` now survives the whole chain (pool → auth → proxyOptions),
 *    so a strict pool can no longer silently fall back to a direct connection.
 *  - `disabledModels` is enforced when routing, not just when listing models,
 *    so a combo can't keep sending traffic to a model that was switched off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const proxyPools = new Map();

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(async (id) => proxyPools.get(id) || null),
}));

const disabledMap = { openai: [], anthropic: [] };
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => disabledMap),
}));

vi.mock("@/sse/services/model.js", () => ({
  // provider/model strings resolve straight through; a bare name is a combo.
  getModelInfo: vi.fn(async (modelStr) => {
    const slash = modelStr.indexOf("/");
    if (slash < 0) return { provider: null, model: modelStr };
    return { provider: modelStr.slice(0, slash), model: modelStr.slice(slash + 1) };
  }),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}));

const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy");
const { buildProxyOptions } = await import("open-sse/utils/proxyOptions.js");
const { isDisabledInMap, filterDisabledModels, isModelDisabled } =
  await import("@/sse/services/disabledModels.js");

beforeEach(() => {
  proxyPools.clear();
  disabledMap.openai = [];
  disabledMap.anthropic = [];
});

describe("proxy pool → strictProxy propagation", () => {
  it("carries strictProxy from the pool into the fetch-level proxyOptions", async () => {
    proxyPools.set("pool-1", {
      id: "pool-1",
      isActive: true,
      proxyUrl: "http://user:pass@127.0.0.1:7890",
      noProxy: "localhost",
      strictProxy: true,
      type: "http",
    });

    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "pool-1" });
    expect(resolved.strictProxy).toBe(true);

    // This is the shape src/sse/services/auth.js stores on the credentials.
    const credentials = {
      providerSpecificData: {
        connectionProxyEnabled: resolved.connectionProxyEnabled,
        connectionProxyUrl: resolved.connectionProxyUrl,
        connectionNoProxy: resolved.connectionNoProxy,
        connectionStrictProxy: resolved.strictProxy === true,
        vercelRelayUrl: resolved.vercelRelayUrl || "",
      },
    };

    expect(buildProxyOptions(credentials)).toEqual({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://user:pass@127.0.0.1:7890",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "",
      strictProxy: true,
    });
  });

  it("keeps strictProxy for relay-type pools too", async () => {
    proxyPools.set("pool-relay", {
      id: "pool-relay",
      isActive: true,
      proxyUrl: "https://relay.example.workers.dev",
      strictProxy: true,
      type: "cloudflare",
    });

    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "pool-relay" });
    expect(resolved.strictProxy).toBe(true);
    expect(resolved.vercelRelayUrl).toBe("https://relay.example.workers.dev");
  });

  it("an inactive pool resolves to no proxy (and does not claim strict)", async () => {
    proxyPools.set("pool-dead", {
      id: "pool-dead",
      isActive: false,
      proxyUrl: "http://127.0.0.1:7890",
      strictProxy: true,
      type: "http",
    });

    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "pool-dead" });
    expect(resolved.source).toBe("none");
    expect(resolved.connectionProxyEnabled).toBe(false);
    expect(buildProxyOptions({ providerSpecificData: resolved }).strictProxy).toBe(false);
  });

  it("defaults to a no-proxy payload when nothing is configured", () => {
    expect(buildProxyOptions({})).toEqual({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      strictProxy: false,
    });
  });
});

describe("disabled models are enforced at routing time", () => {
  it("matches on the storage alias and on the raw provider id", () => {
    // Built-in providers are stored under their alias (`claude` → `cc`),
    // openai/anthropic-compatible nodes under the raw provider id.
    const map = { cc: ["claude-sonnet-4"], "openai-compatible-x": ["local-model"] };
    expect(isDisabledInMap(map, "claude", "claude-sonnet-4")).toBe(true);
    expect(isDisabledInMap(map, "claude", "claude-opus-4")).toBe(false);
    expect(isDisabledInMap(map, "openai-compatible-x", "local-model")).toBe(true);
    expect(isDisabledInMap(map, "openai-compatible-y", "local-model")).toBe(false);
  });

  it("reports a disabled model through isModelDisabled", async () => {
    disabledMap.openai = ["gpt-4o"];
    await expect(isModelDisabled("openai", "gpt-4o")).resolves.toBe(true);
    await expect(isModelDisabled("openai", "gpt-4o-mini")).resolves.toBe(false);
  });

  it("drops disabled entries from a combo list but keeps the rest", async () => {
    disabledMap.openai = ["gpt-4o"];
    const models = ["openai/gpt-4o", "openai/gpt-4o-mini", "anthropic/claude-sonnet-4"];
    await expect(filterDisabledModels(models)).resolves.toEqual([
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4",
    ]);
  });

  it("returns an empty list when every combo entry is disabled", async () => {
    disabledMap.openai = ["gpt-4o", "gpt-4o-mini"];
    await expect(filterDisabledModels(["openai/gpt-4o", "openai/gpt-4o-mini"]))
      .resolves.toEqual([]);
  });

  it("leaves the list untouched when nothing is disabled", async () => {
    const models = ["openai/gpt-4o", "anthropic/claude-sonnet-4"];
    await expect(filterDisabledModels(models)).resolves.toEqual(models);
  });

  it("keeps entries that don't resolve to a concrete provider (nested combos)", async () => {
    disabledMap.openai = ["gpt-4o"];
    await expect(filterDisabledModels(["my-combo", "openai/gpt-4o"]))
      .resolves.toEqual(["my-combo"]);
  });
});
