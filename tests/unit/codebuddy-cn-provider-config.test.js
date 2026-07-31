import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS } from "../../open-sse/providers/index.js";
import { resolveCodebuddyCnModels } from "../../open-sse/services/codebuddyCnModels.js";

const originalFetch = global.fetch;
const config = PROVIDERS["codebuddy-cn"];

afterEach(() => {
  global.fetch = originalFetch;
});

describe("CodeBuddy CN provider-owned service transport", () => {
  it("uses registry model-discovery endpoint and headers", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            models: [{ id: "glm-5.2", name: "GLM-5.2", supportsReasoning: true }],
            agents: [{ name: "cli", models: ["glm-5.2"] }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      resolveCodebuddyCnModels({
        accessToken: "model-token",
        providerSpecificData: { enterpriseId: "enterprise-1" },
      }),
    ).resolves.toMatchObject({ models: [{ id: "glm-5.2", name: "GLM-5.2" }] });

    expect(global.fetch).toHaveBeenCalledWith(
      config.modelDiscovery.urlTemplate.replace("{enterpriseId}", "enterprise-1"),
      expect.objectContaining({
        method: "GET",
        headers: {
          ...config.modelDiscovery.headers,
          Authorization: "Bearer model-token",
        },
      }),
    );
  });
});
