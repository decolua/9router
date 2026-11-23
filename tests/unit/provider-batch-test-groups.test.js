import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connections: [] }));
vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async ({ isActive }) => state.connections.filter((connection) => connection.isActive === isActive)),
}));
vi.mock("@/app/api/providers/[id]/test/testUtils.js", () => ({
  testSingleConnection: vi.fn(async () => ({ valid: true, latencyMs: 1 })),
}));

import { POST } from "@/app/api/providers/test-batch/route.js";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS, OAUTH_PROVIDERS } from "@/shared/constants/providers.js";

function connection(id, provider, authType, isActive = true) {
  return { id, provider, authType, isActive, name: id };
}

async function run(mode, providerId) {
  const response = await POST(new Request("http://localhost/api/providers/test-batch", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, providerId }),
  }));
  return response.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.connections = [
    connection("kiro-oauth", "kiro", "oauth"),
    connection("kiro-key", "kiro", "apikey"),
    connection("kiro-api-key", "kiro", "api_key"),
    connection("kimchi-oauth", "kimchi", "oauth"),
    connection("kimchi-key", "kimchi", "apikey"),
    connection("codex-oauth", "codex", "oauth"),
    connection("codebuddy-key", "codebuddy-intl", "apikey"),
    connection("openai-key", "openai", "apikey"),
    connection("custom-key", "openai-compatible-chat-local", "apikey"),
    connection("inactive-free", "kimchi", "oauth", false),
  ];
});
afterEach(() => { state.connections = []; });

describe("provider dashboard batch-test groups (#2680)", () => {
  it("tests both free-provider categories regardless of their connection credential type", async () => {
    // These registries drive the two lists under the dashboard's Free Tier heading.
    expect(FREE_PROVIDERS.kiro).toBeDefined();
    expect(FREE_TIER_PROVIDERS.kimchi).toBeDefined();
    const result = await run("free");
    expect(result.results.map((entry) => entry.connectionId)).toEqual([
      "kiro-oauth", "kiro-key", "kiro-api-key", "kimchi-oauth", "kimchi-key",
    ]);
    expect(result.summary).toEqual({ total: 5, passed: 5, failed: 0 });
  });

  it("keeps paid OAuth-section providers together for OAuth and API-key credentials", async () => {
    expect(OAUTH_PROVIDERS.codex).toBeDefined();
    expect(OAUTH_PROVIDERS["codebuddy-intl"]).toBeDefined();
    const result = await run("oauth");
    expect(result.results.map((entry) => entry.connectionId)).toEqual(["codex-oauth", "codebuddy-key"]);
    expect(result.results[1].authType).toBe("apikey");
  });

  it("keeps built-in and custom API-key connections in the existing API-key batch", async () => {
    const result = await run("apikey");
    expect(result.results.map((entry) => entry.connectionId)).toEqual(["openai-key", "custom-key"]);
  });

  it("still selects custom connections for the compatible batch", async () => {
    const result = await run("compatible");
    expect(result.results.map((entry) => entry.connectionId)).toEqual(["custom-key"]);
  });

  it("still selects every credential type for a single provider", async () => {
    const result = await run("provider", "kiro");
    expect(result.results.map((entry) => entry.connectionId)).toEqual(["kiro-oauth", "kiro-key", "kiro-api-key"]);
  });

  it("keeps all active connections in the all batch", async () => {
    const result = await run("all");
    expect(result.results.map((entry) => entry.connectionId)).toEqual([
      "kiro-oauth", "kiro-key", "kiro-api-key", "kimchi-oauth", "kimchi-key",
      "codex-oauth", "codebuddy-key", "openai-key", "custom-key",
    ]);
    expect(result.summary.total).toBe(9);
  });
});
