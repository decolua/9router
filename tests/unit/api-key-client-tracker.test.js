import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveApiKeyId: vi.fn(),
  getIdentity: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getActiveApiKeyId: mocks.getActiveApiKeyId,
  recordApiKeyClientRequest: mocks.record,
}));
vi.mock("@/lib/apiKeyClientIdentity", () => ({
  getApiKeyClientIdentity: mocks.getIdentity,
}));

const { trackApiKeyClientActivity } = await import("@/sse/services/apiKeyClientActivity.js");

const request = new Request("https://router.test/v1/responses", {
  headers: { Authorization: "Bearer client-secret" },
});

describe("API key client activity tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveApiKeyId.mockResolvedValue("key-id");
    mocks.getIdentity.mockResolvedValue({ fingerprint: "fingerprint" });
    mocks.record.mockImplementation(async (apiKeyId, identity) => ({
      apiKeyId,
      fingerprint: identity.fingerprint,
    }));
  });

  it("resolves a valid key and enqueues sanitized identity metadata", async () => {
    await expect(trackApiKeyClientActivity({
      request,
      body: { model: "test/model" },
      apiKey: "client-secret",
      endpoint: "/v1/responses",
    })).resolves.toEqual({ apiKeyId: "key-id", fingerprint: "fingerprint" });

    expect(mocks.record).toHaveBeenCalledWith(
      "key-id",
      { fingerprint: "fingerprint" },
      "/v1/responses",
    );
  });

  it("uses an already-resolved API key ID without another lookup", async () => {
    await expect(trackApiKeyClientActivity({
      request,
      body: { model: "test/model" },
      apiKey: "client-secret",
      apiKeyId: "resolved-key-id",
      endpoint: "/v1/responses",
    })).resolves.toEqual({ apiKeyId: "resolved-key-id", fingerprint: "fingerprint" });

    expect(mocks.getActiveApiKeyId).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      "resolved-key-id",
      { fingerprint: "fingerprint" },
      "/v1/responses",
    );
  });

  it("does not enqueue missing or invalid API keys", async () => {
    mocks.getActiveApiKeyId.mockResolvedValue(null);

    await expect(trackApiKeyClientActivity({ request, body: {}, apiKey: "invalid" })).resolves.toBeNull();
    await expect(trackApiKeyClientActivity({ request, body: {}, apiKey: null })).resolves.toBeNull();

    expect(mocks.getIdentity).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("fails open and rate-limits secret-free warnings", async () => {
    mocks.getActiveApiKeyId.mockRejectedValue(new Error("database includes client-secret"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(trackApiKeyClientActivity({ request, body: {}, apiKey: "client-secret" })).resolves.toBeNull();
    await expect(trackApiKeyClientActivity({ request, body: {}, apiKey: "client-secret" })).resolves.toBeNull();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0].join(" ")).not.toContain("client-secret");
  });
});
