import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}));

import { handleVideoGet } from "@/sse/handlers/videoGeneration.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { isModelLockActive } from "open-sse/services/accountFallback.js";

let connections;
const poll = (id = "account-a") => handleVideoGet(new Request("http://localhost/v1/videos/job-a", {
  headers: id ? { "x-connection-id": id } : {},
}), "job-a");
const upstream = (status) => new Response(JSON.stringify(
  status === 200 ? { status: "pending" } : { error: "poll failed" }
), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  connections = ["account-a", "account-b"].map(id => ({
    id, provider: "xai", isActive: true, authType: "apikey", apiKey: `dummy-${id}`,
  }));
  db.getProviderConnections.mockImplementation(async ({ provider, isActive } = {}) =>
    connections.filter(c => (!provider || c.provider === provider) && (!isActive || c.isActive)));
  db.getProviderConnectionById.mockImplementation(async id => connections.find(c => c.id === id));
  db.updateProviderConnection.mockImplementation(async (id, update) => Object.assign(connections.find(c => c.id === id), update));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("video polling account isolation (real credential selection and cooldowns)", () => {
  it.each([400, 404, 410, 422])("returns job error %s without locking or rotating accounts", async status => {
    fetch.mockImplementation(async () => upstream(status));
    expect((await poll()).status).toBe(status);
    expect((await poll()).status).toBe(status);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers.Authorization).toBe("Bearer dummy-account-a");
    }
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
    expect(isModelLockActive(connections[0], "grok-4")).toBe(false);
  });

  it.each([401, 402, 403, 429, 503])("scopes %s cooldown to polls and does not rotate a pinned job", async status => {
    fetch.mockImplementation(async () => upstream(status));
    expect((await poll()).status).toBe(status);
    expect(connections[0]).not.toHaveProperty("modelLock___all");
    expect(isModelLockActive(connections[0], "grok-4")).toBe(false);
    const chat = await getProviderCredentials("xai", null, "grok-4");
    expect(chat.connectionId).toBe("account-a");
    const blocked = await poll();
    expect(blocked.status).toBe(status);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(connections[1]).not.toHaveProperty("lastError");
  });

  it.each(["missing", "inactive", "locked"])("does not substitute another account when the pinned account is %s", async state => {
    if (state === "missing") connections.shift();
    if (state === "inactive") connections[0].isActive = false;
    if (state === "locked") connections[0].modelLock___all = new Date(Date.now() + 60000).toISOString();
    fetch.mockImplementation(async () => upstream(200));
    const response = await poll();
    expect(response.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a successful pinned poll on its account and forwards the connection header", async () => {
    fetch.mockImplementation(async () => upstream(200));
    const response = await poll("account-b");
    expect(await response.json()).toEqual({ status: "pending" });
    expect(response.headers.get("x-9router-connection-id")).toBe("account-b");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer dummy-account-b");
  });


  it("clears an expired poll cooldown without clearing an unrelated chat lock", async () => {
    connections[0].modelLock___video_poll__ = new Date(Date.now() - 1000).toISOString();
    connections[0]["modelLock_grok-4"] = new Date(Date.now() + 60000).toISOString();
    connections[0].testStatus = "unavailable";
    fetch.mockImplementation(async () => upstream(200));
    expect((await poll()).status).toBe(200);
    expect(connections[0].modelLock___video_poll__).toBeNull();
    expect(isModelLockActive(connections[0], "grok-4")).toBe(true);
    expect(connections[0].testStatus).toBe("unavailable");
  });

  it("preserves ordinary soft-preference fallback outside account-bound polling", async () => {
    connections[0].modelLock___all = new Date(Date.now() + 60000).toISOString();
    const credentials = await getProviderCredentials("xai", null, "grok-4", { preferredConnectionId: "account-a" });
    expect(credentials.connectionId).toBe("account-b");
  });

  it("preserves unpinned polling for existing single-account clients", async () => {
    fetch.mockImplementation(async () => upstream(200));
    expect((await poll(null)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
