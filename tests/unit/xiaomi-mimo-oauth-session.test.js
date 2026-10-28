/**
 * Regression: the poll-status/exchange session lifecycle for xiaomi-mimo.
 *
 * The original PR cleared the session inside poll-status, so the client's
 * following POST /exchange always saw a missing session and returned 400 —
 * the whole browser-OAuth fallback was dead. These tests pin the contract:
 *   - a finished session survives /poll-status until /exchange consumes it
 *   - a failed session is cleaned up by /poll-status itself
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/oauth/providers", () => ({
  getProvider: vi.fn(),
  generateAuthData: vi.fn(),
  exchangeTokens: vi.fn(),
  requestDeviceCode: vi.fn(),
  pollForToken: vi.fn(),
}));

vi.mock("@/models", () => ({
  createProviderConnection: vi.fn(async (d) => ({ id: "conn-1", ...d })),
}));

vi.mock("open-sse/shared/mimoAccount.js", () => ({
  readDesktopPassToken: vi.fn(async () => ({ passToken: "pt-abc", userId: "u1", cUserId: "c1" })),
}));

vi.mock("@/lib/oauth/utils/ideDetect", () => ({ detectIdeInstalled: vi.fn() }));

// Session store backing the mocked OAuth server helpers, so the test can assert
// on real lifecycle transitions rather than on call counts alone.
const sessions = new Map();
const stopped = { count: 0 };

vi.mock("@/lib/oauth/utils/server", () => {
  const notUsed = () => { throw new Error("unexpected helper"); };
  const noop = () => {};
  return {
    startCodexProxy: notUsed, stopCodexProxy: noop, registerCodexSession: noop,
    getCodexSessionStatus: () => null, clearCodexSession: noop,
    startXaiProxy: notUsed, stopXaiProxy: noop, registerXaiSession: noop,
    getXaiSessionStatus: () => null, clearXaiSession: noop,
    startTraeProxy: notUsed, stopTraeProxy: noop, registerTraeSession: noop,
    getTraeSessionStatus: () => null, clearTraeSession: noop,
    startWindsurfProxy: notUsed, stopWindsurfProxy: noop, registerWindsurfSession: noop,
    getWindsurfSessionStatus: () => null, clearWindsurfSession: noop,
    startZedProxy: notUsed, stopZedProxy: noop, registerZedSession: noop,
    getZedSessionStatus: () => null, clearZedSession: noop,
    startXiaomiMimoProxy: notUsed,
    stopXiaomiMimoProxy: () => { stopped.count += 1; },
    registerXiaomiMimoSession: () => {},
    getXiaomiMimoSessionStatus: (state) => {
      const s = sessions.get(state);
      return s ? { status: s.status, result: s.result || null, error: s.error || null } : null;
    },
    clearXiaomiMimoSession: (state) => { sessions.delete(state); },
  };
});

const { GET, POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");

const get = (action, state) =>
  GET(new Request(`http://localhost/api/oauth/xiaomi-mimo/${action}?state=${state}`), {
    params: Promise.resolve({ provider: "xiaomi-mimo", action }),
  });

const exchange = (state) =>
  POST(
    new Request("http://localhost/api/oauth/xiaomi-mimo/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    }),
    { params: Promise.resolve({ provider: "xiaomi-mimo", action: "exchange" }) },
  );

describe("xiaomi-mimo OAuth session lifecycle", () => {
  beforeEach(() => {
    sessions.clear();
    stopped.count = 0;
  });

  it("keeps a finished session alive so /exchange can consume it", async () => {
    sessions.set("st1", { status: "done", result: { uid: "u1", accessToken: "sk-x", baseUrl: "https://api.xiaomimimo.com/v1" } });

    const poll = await get("poll-status", "st1");
    expect(poll.status).toBe(200);
    expect(await poll.json()).toMatchObject({ status: "done" });

    // The bug: this used to be gone, making /exchange always 400.
    expect(sessions.has("st1")).toBe(true);

    const res = await exchange("st1");
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("clears the session once /exchange consumed it", async () => {
    sessions.set("st1", { status: "done", result: { uid: "u1", accessToken: "sk-x" } });
    await exchange("st1");
    expect(sessions.has("st1")).toBe(false);
  });

  it("cleans up a failed session in poll-status and stops the proxy", async () => {
    sessions.set("st2", { status: "error", error: "Could not decrypt with any pending session key" });

    const poll = await get("poll-status", "st2");
    expect(await poll.json()).toMatchObject({ status: "error" });

    expect(sessions.has("st2")).toBe(false);
    expect(stopped.count).toBe(1);
  });

  it("persists the Desktop passToken onto the connection (Preview models need it)", async () => {
    const { createProviderConnection } = await import("@/models");
    sessions.set("st3", { status: "done", result: { uid: "u1", accessToken: "sk-x" } });

    await exchange("st3");

    const arg = createProviderConnection.mock.calls.at(-1)[0];
    expect(arg.provider).toBe("xiaomi-mimo");
    expect(arg.providerSpecificData.mimoPassToken).toBe("pt-abc");
    expect(arg.providerSpecificData.mimoUserId).toBe("u1");
  });

  it("still reports unknown for an unregistered state", async () => {
    const poll = await get("poll-status", "nope");
    expect(await poll.json()).toEqual({ status: "unknown" });
  });

  it("rejects /exchange without a state", async () => {
    const res = await POST(
      new Request("http://localhost/api/oauth/xiaomi-mimo/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ provider: "xiaomi-mimo", action: "exchange" }) },
    );
    expect(res.status).toBe(400);
  });
});
