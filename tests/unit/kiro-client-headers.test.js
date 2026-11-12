import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KIRO_IDE_VERSION } from "../../open-sse/config/kiroClient.js";
import { buildKiroIdentityHeaders } from "../../open-sse/shared/kiroHeaders.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { resolveKiroModels, clearKiroModelCache } from "../../open-sse/services/kiroModels.js";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

const fingerprint = (seed) => createHash("sha256").update(seed).digest("hex");
const credentials = {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  providerSpecificData: { clientId: "test-client-id", authMethod: "builder-id" },
};

function expectIdentity(headers, seed) {
  const identity = `KiroIDE-${KIRO_IDE_VERSION}-${fingerprint(seed)}`;
  expect(headers["User-Agent"]).toContain(identity);
  expect(headers["x-amz-user-agent"]).toBe(`aws-sdk-js/1.0.0 ${identity}`);
  expect(headers["User-Agent"]).not.toContain("kiro-ide/");
  expect(headers["X-Amz-User-Agent"]).toBeUndefined();
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearKiroModelCache();
});

describe("Kiro client identity", () => {
  it("uses the stable IDE version in both headers without changing the SDK version", () => {
    expect(KIRO_IDE_VERSION).toBe("1.4.154");
    const headers = buildKiroIdentityHeaders(credentials);
    expectIdentity(headers, "test-client-id");
    expect(headers["User-Agent"]).toContain("api/codewhispererruntime#1.0.0");
    expect(headers["User-Agent"]).not.toContain("test-client-id");
    expect(headers["User-Agent"]).not.toContain("test-refresh-token");
    expect(headers["User-Agent"]).not.toContain("test-access-token");
  });

  it("keeps a stable identity when the OAuth access token rotates", () => {
    expect(buildKiroIdentityHeaders({ ...credentials, accessToken: "rotated-token" }))
      .toEqual(buildKiroIdentityHeaders(credentials));
  });

  it.each([
    [{ refreshToken: "refresh", accessToken: "access", providerSpecificData: { profileArn: "profile" } }, "refresh"],
    [{ accessToken: "access", providerSpecificData: { profileArn: "profile" } }, "profile"],
    [{ apiKey: "key", accessToken: "access" }, "key"],
    [{ accessToken: "access" }, "access"],
    [undefined, "kiro-anonymous"],
  ])("preserves credential seed precedence and hashes the fallback", (auth, seed) => {
    expectIdentity(buildKiroIdentityHeaders(auth), seed);
  });

  it.each(["builder-id", "api_key", "external_idp"])("adds the identity without changing %s authentication", (authMethod) => {
    const auth = {
      ...credentials,
      providerSpecificData: { ...credentials.providerSpecificData, authMethod },
    };
    const headers = new KiroExecutor().buildHeaders(auth, true,
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse");
    expectIdentity(headers, "test-client-id");
    expect(headers.Authorization).toBe("Bearer test-access-token");
    expect(headers.TokenType).toBe(authMethod === "api_key" ? "API_KEY" : authMethod === "external_idp" ? "EXTERNAL_IDP" : undefined);
    expect(headers["X-Amz-Target"]).toBe("AmazonCodeWhispererStreamingService.GenerateAssistantResponse");
    expect(headers["x-amzn-kiro-agent-mode"]).toBe("spec");
    expect(headers["x-amzn-codewhisperer-machine-id"]).toBe("kiro-desktop");
  });

  it("shares the same identity with the live model catalog and preserves its headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ modelId: "auto", modelName: "Auto" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolveKiroModels(credentials, { forceRefresh: true });
    expect(result.models.length).toBeGreaterThan(0);
    const [, init] = fetchMock.mock.calls[0];
    expectIdentity(init.headers, "test-client-id");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-access-token",
      Accept: "application/json",
      "x-amzn-kiro-agent-mode": "vibe",
      "x-amzn-codewhisperer-optout": "true",
    });
  });

  it("shares the identity with API-key validation without exposing the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ modelId: "auto" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await new KiroService().listAvailableApiKeyModels("test-api-key");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("https://q.us-east-1.amazonaws.com/ListAvailableModels");
    expectIdentity(init.headers, "test-api-key");
    expect(init.headers["User-Agent"]).not.toContain("test-api-key");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-api-key", TokenType: "API_KEY" });
    expect(buildKiroIdentityHeaders({ accessToken: "test-api-key", providerSpecificData: { authMethod: "api_key" } }))
      .toEqual(buildKiroIdentityHeaders({ apiKey: "test-api-key" }));
  });
});
