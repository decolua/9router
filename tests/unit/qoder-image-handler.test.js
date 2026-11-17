// Image handler with Qoder: non-PAT connections are skipped with a Qoder-specific message,
// and image requests are tracked as pending for the dashboard topology.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [],
  handleImageGenerationCore: vi.fn(),
  markAccountUnavailable: vi.fn(),
  trackPendingRequest: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async (_provider, excludeConnectionIds) =>
    mocks.connections.find((c) => !excludeConnectionIds.has(c.connectionId)) || null,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: () => "client-key",
  isValidApiKey: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false }) }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "qoder", model: "imagegen" }),
  getComboModels: async () => null,
}));
vi.mock("../../open-sse/handlers/imageGenerationCore.js", () => ({
  handleImageGenerationCore: mocks.handleImageGenerationCore,
}));
vi.mock("../../open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: message }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: message }, { status }),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("../../open-sse/services/combo.js", () => ({ handleComboChat: vi.fn() }));
vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), maskKey: vi.fn(),
}));
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
  trackPendingRequest: mocks.trackPendingRequest,
}));

import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";

const imageRequest = () => new Request("http://localhost/v1/images/generations", {
  method: "POST",
  body: JSON.stringify({ model: "qd/imagegen", prompt: "a lighthouse" }),
});

describe("Qoder image account selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleImageGenerationCore.mockResolvedValue({ success: true, response: Response.json({ data: [{ url: "u" }] }) });
  });

  it("skips OAuth connections and generates with the PAT connection, tracking it as pending", async () => {
    mocks.connections = [
      { connectionId: "oauth-connection", accessToken: "dt-device-token" },
      { connectionId: "pat-connection-1", apiKey: "pt-personal-token" },
    ];
    const res = await handleImageGeneration(imageRequest());
    expect(res.status).toBe(200);
    expect(mocks.handleImageGenerationCore).toHaveBeenCalledTimes(1);
    expect(mocks.handleImageGenerationCore.mock.calls[0][0].credentials.connectionId).toBe("pat-connection-1");
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(mocks.trackPendingRequest.mock.calls).toEqual([
      ["imagegen", "qoder", "pat-connection-1", true],
      ["imagegen", "qoder", "pat-connection-1", false, false],
    ]);
  });

  it("explains that a PAT is needed when only OAuth connections exist", async () => {
    mocks.connections = [{ connectionId: "oauth-connection", accessToken: "dt-device-token" }];
    const res = await handleImageGeneration(imageRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Personal Access Token/);
    expect(mocks.handleImageGenerationCore).not.toHaveBeenCalled();
    expect(mocks.trackPendingRequest).not.toHaveBeenCalled();
  });

  it("ends the pending state as an error when generation fails", async () => {
    mocks.connections = [{ connectionId: "pat-connection-1", apiKey: "pt-personal-token" }];
    mocks.handleImageGenerationCore.mockResolvedValue({ success: false, status: 502, error: "boom", response: Response.json({ error: "boom" }, { status: 502 }) });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    await handleImageGeneration(imageRequest());
    expect(mocks.trackPendingRequest).toHaveBeenLastCalledWith("imagegen", "qoder", "pat-connection-1", false, true);
  });
});
