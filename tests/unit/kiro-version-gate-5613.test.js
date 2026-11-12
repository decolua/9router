/**
 * #5613 — Kiro's client-version gate answers every call with
 * 400/403 "This version of Kiro is no longer supported" when the request
 * identifies as an old client (`kiro-ide/1.0.0`, `KiroIDE-0.10.32`).
 * Every Kiro / Amazon Q call must present one current Kiro IDE identity.
 */
import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const proxyFetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (...args) => proxyFetchMock(...args),
}));

const { KIRO_IDE_VERSION } = await import("../../open-sse/config/kiroClient.js");
const { buildKiroIdentityHeaders } = await import("../../open-sse/shared/kiroIdentity.js");
const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
const { resolveKiroModels, clearKiroModelCache } = await import("../../open-sse/services/kiroModels.js");
const { getKiroUsage } = await import("../../open-sse/services/usage/kiro.js");
const { KiroService } = await import("../../src/lib/oauth/services/kiro.js");
const { fetchKiroProfileArn } = await import("../../src/lib/oauth/providerHelpers.js");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const credentials = {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  providerSpecificData: { clientId: "test-client-id", authMethod: "builder-id" },
};

function semverAtLeast(version, floor) {
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

function headerValue(headers, name) {
  const matches = Object.entries(headers).filter(([k]) => k.toLowerCase() === name);
  expect(matches, `exactly one ${name} header`).toHaveLength(1);
  return matches[0][1];
}

function expectCurrentIdentity(headers) {
  const ua = headerValue(headers, "user-agent");
  const amz = headerValue(headers, "x-amz-user-agent");
  expect(ua).toMatch(new RegExp(`KiroIDE-${KIRO_IDE_VERSION.replace(/\./g, "\\.")}-[0-9a-f]{64}$`));
  expect(amz).toMatch(new RegExp(`^aws-sdk-js/1\\.0\\.0 KiroIDE-${KIRO_IDE_VERSION.replace(/\./g, "\\.")}-[0-9a-f]{64}$`));
  expect(ua).not.toContain("kiro-ide/");
  return { ua, amz };
}

function okJson(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  proxyFetchMock.mockReset();
  clearKiroModelCache();
});

describe("Kiro client identity (#5613)", () => {
  it("advertises an IDE version above both the current and the 2027-01-15 floor", () => {
    expect(semverAtLeast(KIRO_IDE_VERSION, "0.12.291")).toBe(true);
  });

  it("derives a stable per-account machine id without leaking credentials", () => {
    const headers = buildKiroIdentityHeaders(credentials);
    const { ua } = expectCurrentIdentity(headers);
    expect(ua.endsWith(sha256("test-client-id"))).toBe(true);
    for (const secret of ["test-client-id", "test-refresh-token", "test-access-token"]) {
      expect(JSON.stringify(headers)).not.toContain(secret);
    }
    expect(buildKiroIdentityHeaders({ ...credentials, accessToken: "rotated" })).toEqual(headers);
  });

  it("sends the streaming-API identity on inference, once per header", () => {
    const headers = new KiroExecutor().buildHeaders(credentials, true,
      "https://q.us-east-1.amazonaws.com/generateAssistantResponse");
    const { ua } = expectCurrentIdentity(headers);
    expect(ua).toContain("api/codewhispererstreaming#1.0.0 m/E ");
    expect(headers.Authorization).toBe("Bearer test-access-token");
  });

  it("sends the identity on the live model catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ models: [{ modelId: "auto", modelName: "Auto" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await resolveKiroModels(credentials, { forceRefresh: true });
    const { ua } = expectCurrentIdentity(fetchMock.mock.calls[0][1].headers);
    expect(ua).toContain("api/codewhispererruntime#1.0.0 m/N,E ");
  });

  it("sends the identity on every usage endpoint attempt", async () => {
    proxyFetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    await getKiroUsage("test-access-token", credentials.providerSpecificData).catch(() => {});
    expect(proxyFetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of proxyFetchMock.mock.calls) expectCurrentIdentity(init.headers);
  });

  it("sends the identity on API-key validation, profile and model discovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({
      models: [{ modelId: "auto" }],
      profiles: [{ arn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC" }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new KiroService();
    await service.listAvailableApiKeyModels("test-api-key");
    await service.listAvailableProfiles("test-access-token");
    await service.listAvailableModels("test-access-token", "arn:aws:codewhisperer:us-east-1:1:profile/A");
    await fetchKiroProfileArn("test-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expectCurrentIdentity(init.headers);
      expect(JSON.stringify(init.headers["User-Agent"])).not.toContain("test-api-key");
    }
  });
});
