import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
const mocks = vi.hoisted(() => ({ update: vi.fn(), latest: vi.fn(), fetch: vi.fn(), refresh: vi.fn(), httpsRequest: vi.fn() }));
vi.mock("node:https", () => ({ default: { request: mocks.httpsRequest } }));
const credentials = {
  connectionId: "offline-connection", authType: "oauth", accessToken: "offline-old-token", refreshToken: "offline-refresh",
  expiresAt: "2000-01-01T00:00:00.000Z", providerSpecificData: { workspaceId: "workspace", customMetadata: "preserve-me" },
};
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: true }), getProviderConnectionById: mocks.latest, updateProviderConnection: mocks.update }));
vi.mock("@/lib/localDb.js", () => ({ getSettings: async () => ({ requireApiKey: true }), getProviderConnectionById: mocks.latest, updateProviderConnection: mocks.update }));
vi.mock("@/sse/services/auth.js", () => ({ extractApiKey: () => "offline-key", isValidApiKey: async () => true, getProviderCredentials: async () => credentials, clearAccountError: async () => {}, markAccountUnavailable: async () => ({ shouldFallback: false }) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (url, options) => options.directFetch(url, options) }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async () => ({ provider: "codex", model: "transcribe" }) }));
vi.mock("@/sse/services/keyAccess.js", () => ({ getKeyAccessContext: async () => null, enforceKeyAccessResolved: async () => null }));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({ shouldRefreshCredentials: () => true, refreshProviderCredentials: mocks.refresh }));
const { POST } = await import("../../src/app/api/v1/audio/transcriptions/route.js");
function request() {
  const pcm = Buffer.alloc(44 + 4800);
  pcm.write("RIFF"); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(24000, 24); pcm.writeUInt32LE(48000, 28); pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(4800, 40);
  const form = new FormData(); form.set("model", "cx/transcribe"); form.set("file", new Blob([pcm], { type: "audio/wav" }), "input.wav");
  return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: form });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.latest.mockResolvedValue(null); mocks.update.mockResolvedValue({ id: credentials.connectionId });
  mocks.refresh.mockResolvedValue({ accessToken: "offline-refreshed-token", refreshToken: "offline-rotated-refresh", expiresIn: 3600, providerSpecificData: { chatgptAccountId: "account" }, lastRefreshAt: new Date().toISOString() });
  mocks.fetch.mockImplementation(async () => Response.json({ text: "persisted" }));
  mocks.httpsRequest.mockImplementation((_url, options, callback) => {
    const req = new EventEmitter();
    req.end = (body) => {
      const response = Readable.from([Buffer.from(JSON.stringify({ text: "persisted" }))]);
      response.headers = { "content-type": "application/json" }; response.statusCode = 200; response.statusMessage = "OK";
      callback(response); req.options = options; req.body = body;
    };
    return req;
  });
});
it("uses the real persisted refresh service before sending expired-account OAuth audio", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith("offline-connection", expect.objectContaining({ accessToken: "offline-refreshed-token", refreshToken: "offline-rotated-refresh", providerSpecificData: { workspaceId: "workspace", customMetadata: "preserve-me", chatgptAccountId: "account" } }));
  expect(mocks.httpsRequest.mock.calls[0][1].headers.Authorization).toBe("Bearer offline-refreshed-token");
  expect(mocks.httpsRequest.mock.calls[0][1].headers["ChatGPT-Account-Id"]).toBe("workspace");
  expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.httpsRequest.mock.invocationCallOrder[0]);
});
it("rejects invalid refreshed tokens before contacting transcription upstream", async () => {
  mocks.refresh.mockResolvedValue({ accessToken: "invalid\r\ncredential", expiresIn: 3600 });
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain("credential");
});
