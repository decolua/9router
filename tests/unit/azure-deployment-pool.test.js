import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { parseAzureDeploymentNames } from "../../open-sse/providers/azureDeployment.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
const executor = new AzureExecutor();

function connection(id, deployment, enabledModels) {
  return {
    id, provider: "azure", isActive: true, apiKey: id,
    providerSpecificData: {
      azureEndpoint: "https://example.openai.azure.com/",
      deployment,
      ...(enabledModels ? { deploymentMode: "pool", enabledModels } : {}),
    },
  };
}

beforeEach(() => {
  db.getProviderConnections.mockResolvedValue([
    connection("legacy", "fixed-deployment"),
    connection("pool-a", "fixed-a", ["assistant-a"]),
    connection("pool-b", "fixed-b", ["assistant-b"]),
  ]);
});

describe("Azure deployment pools", () => {
  it("selects a connection advertising the requested deployment and dispatches to its URL", async () => {
    const credentials = await getProviderCredentials("azure", null, "assistant-b");
    expect(credentials.connectionId).toBe("pool-b");
    expect(executor.buildUrl("assistant-b", true, 0, credentials)).toBe(
      "https://example.openai.azure.com/openai/deployments/assistant-b/chat/completions?api-version=2024-10-01-preview");
    expect(await getProviderCredentials("azure", new Set(["pool-b"]), "assistant-b")).toBeNull();
  });

  it("keeps the legacy fixed deployment for ordinary requests", async () => {
    const credentials = await getProviderCredentials("azure", null, "unlisted-model");
    expect(credentials.connectionId).toBe("legacy");
    expect(executor.buildUrl("unlisted-model", false, 0, credentials)).toContain("/deployments/fixed-deployment/");
  });

  it("lists deployments from every active pool and normalizes the UI's names", async () => {
    expect(parseAzureDeploymentNames(" assistant-a , assistant-b, assistant-a, ")).toEqual(["assistant-a", "assistant-b"]);
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    expect(models.map(({ id }) => id)).toEqual(expect.arrayContaining(["azure/assistant-a", "azure/assistant-b"]));
  });
});
