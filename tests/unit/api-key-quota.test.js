import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCodexUsage: vi.fn(),
  getClaudeUsage: vi.fn(),
  handleChatCore: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("open-sse/services/usage/codex.js", () => ({ getCodexUsage: mocks.getCodexUsage }));
vi.mock("open-sse/services/usage/claude.js", () => ({ getClaudeUsage: mocks.getClaudeUsage }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: mocks.logDebug,
  info: vi.fn(),
  warn: mocks.logWarn,
  maskKey: (key) => key,
}));

const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function setup() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-quota-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const authorization = await import("@/lib/auth/apiKeyAuthorization.js");
  const quota = await import("@/sse/services/apiKeyQuota.js");
  return { db, authorization, quota };
}

beforeEach(() => {
  mocks.getCodexUsage.mockReset();
  mocks.getClaudeUsage.mockReset();
  mocks.handleChatCore.mockReset();
  mocks.logDebug.mockReset();
  mocks.logWarn.mockReset();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function quotaWindow(used, resetAt) {
  return { used, total: 100, remaining: 100 - used, resetAt, unlimited: false };
}

describe("API key quota", () => {
  it("selects 5h before 7d and falls back to 7d when it is the only bank", async () => {
    const { quota } = await setup();
    const fiveHourReset = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const weeklyReset = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    expect(quota.selectShortestQuota({
      "session (5h)": quotaWindow(10, fiveHourReset),
      "weekly (7d)": quotaWindow(90, weeklyReset),
    }, "claude", "claude-sonnet").name).toBe("session (5h)");

    expect(quota.selectShortestQuota({
      "weekly (7d)": quotaWindow(20, weeklyReset),
    }, "claude", "claude-sonnet").name).toBe("weekly (7d)");
  });

  it("allocates the observed account delta to the API key and blocks at its limit", async () => {
    const { db, authorization, quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const key = await db.createApiKey("limited", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: authorization.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          "codex-a": {
            models: ["codex/gpt-5.6-luna"],
            imageModels: [],
            quotaPercent: 40,
          },
        },
      }),
    });
    const apiKeyRecord = await db.getApiKeyById(key.id);
    const credentials = { accessToken: "token", providerSpecificData: {} };

    mocks.getCodexUsage
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(10, resetAt) } })
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(50, resetAt) } });

    const before = await quota.checkApiKeyQuota({
      apiKeyRecord,
      connectionId: "codex-a",
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
    });
    expect(before).toMatchObject({ exceeded: false, usedPercent: 0, limit: 40, quotaName: "session" });

    await quota.recordApiKeyQuotaUsage({
      apiKeyRecord,
      connectionId: "codex-a",
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
      usage: { prompt_tokens: 500, completion_tokens: 500 },
    });

    const after = await quota.checkApiKeyQuota({
      apiKeyRecord,
      connectionId: "codex-a",
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
    });
    expect(after.exceeded).toBe(true);
    expect(after.usedPercent).toBeCloseTo(40);
  });

  it("uses Claude weekly quota when the account has no 5h bank", async () => {
    const { db, authorization, quota } = await setup();
    const resetAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const key = await db.createApiKey("claude-limited", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: authorization.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          "claude-a": { models: ["claude/claude-sonnet-4-6"], imageModels: [], quotaPercent: 30 },
        },
      }),
    });
    const apiKeyRecord = await db.getApiKeyById(key.id);
    const credentials = { accessToken: "claude-token", providerSpecificData: {} };
    mocks.getClaudeUsage
      .mockResolvedValueOnce({ quotas: { "weekly (7d)": quotaWindow(10, resetAt) } })
      .mockResolvedValueOnce({ quotas: { "weekly (7d)": quotaWindow(40, resetAt) } });

    await quota.checkApiKeyQuota({ apiKeyRecord, connectionId: "claude-a", provider: "claude", model: "claude-sonnet-4-6", credentials });
    await quota.recordApiKeyQuotaUsage({
      apiKeyRecord,
      connectionId: "claude-a",
      provider: "claude",
      model: "claude-sonnet-4-6",
      credentials,
      usage: { input_tokens: 500, output_tokens: 500 },
    });
    const result = await quota.checkApiKeyQuota({ apiKeyRecord, connectionId: "claude-a", provider: "claude", model: "claude-sonnet-4-6", credentials });

    expect(result).toMatchObject({ exceeded: true, limit: 30, quotaName: "weekly (7d)" });
  });

  it("resets API-key usage when the provider moves to a new bank", async () => {
    const { quota } = await setup();
    const first = quota.__test__.newWindow({ name: "session", used: 10, resetAt: "2026-08-30T12:00:00.000Z" });
    first.charged.keyA = 35;

    const next = quota.__test__.reconcile(first, {
      name: "session",
      used: 1,
      resetAt: "2026-08-30T17:00:00.000Z",
    });

    expect(next.charged).toEqual({});
    expect(quota.__test__.keyUsage(next, "keyA")).toBe(0);
  });

  it("charges the request that starts a new sliding 5h bank", async () => {
    const { quota } = await setup();
    const previous = quota.__test__.newWindow({ name: "session", used: 0, resetAt: "2026-08-30T12:00:00.000Z" });
    previous.pending.keyA = 1;

    const next = quota.__test__.reconcile(previous, {
      name: "session",
      used: 3,
      resetAt: "2026-08-30T17:00:00.000Z",
    }, true);

    expect(quota.__test__.keyUsage(next, "keyA")).toBeCloseTo(3);
  });

  it("keeps the ledger when provider resetAt drifts by a few minutes", async () => {
    const { quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const state = quota.__test__.newWindow({ name: "session", used: 20, resetAt: resetAt.toISOString() });
    state.charged.keyA = 2.4;

    const next = quota.__test__.reconcile(state, {
      name: "session",
      used: 21,
      resetAt: new Date(resetAt.getTime() + 90 * 1000).toISOString(),
    });

    expect(quota.__test__.keyUsage(next, "keyA")).toBeCloseTo(2.4);
  });

  it("learns per-model rates and uses them for mixed concurrent allocation", async () => {
    const { quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    let state = quota.__test__.newWindow({ name: "session", used: 0, resetAt });

    quota.__test__.addPending(state, "keySol", "codex/gpt-5.6-sol", 1);
    state = quota.__test__.reconcile(state, { name: "session", used: 4, resetAt });
    quota.__test__.addPending(state, "keyLuna", "codex/gpt-5.6-luna", 1);
    state = quota.__test__.reconcile(state, { name: "session", used: 5, resetAt });

    quota.__test__.addPending(state, "keySol", "codex/gpt-5.6-sol", 1);
    quota.__test__.addPending(state, "keyLuna", "codex/gpt-5.6-luna", 1);
    state = quota.__test__.reconcile(state, { name: "session", used: 10, resetAt });

    expect(state.profileRates["codex/gpt-5.6-sol"].rate).toBeCloseTo(4);
    expect(state.profileRates["codex/gpt-5.6-luna"].rate).toBeCloseTo(1);
    expect(state.charged.keySol).toBeCloseTo(8);
    expect(state.charged.keyLuna).toBeCloseTo(2);
  });

  it("separates chat effort and image size/quality learning profiles", async () => {
    const { quota } = await setup();

    expect(quota.buildQuotaProfile({ provider: "codex", model: "gpt-5.6-luna", effort: "low" }))
      .toBe("chat:codex/gpt-5.6-luna:effort=low");
    expect(quota.buildQuotaProfile({ provider: "codex", model: "gpt-5.6-luna", effort: "xhigh" }))
      .toBe("chat:codex/gpt-5.6-luna:effort=xhigh");
    expect(quota.buildQuotaProfile({ provider: "codex", model: "gpt-5.6-sol", effort: "ultra" }))
      .toBe("chat:codex/gpt-5.6-sol:effort=max");
    expect(quota.buildQuotaProfile({ provider: "codex", model: "gpt-5.5-image", kind: "image", size: "1024x1024", quality: "high" }))
      .toBe("image:codex/gpt-5.5-image:size=1024x1024:quality=high");
  });

  it("falls back while a concurrent request is still pending quota accounting", async () => {
    const { db, authorization, quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const first = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "first", accessToken: "token-1" });
    const second = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "second", accessToken: "token-2" });
    const key = await db.createApiKey("limited", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: authorization.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          [first.id]: { models: ["codex/gpt-5.6-luna"], imageModels: [], quotaPercent: 40 },
          [second.id]: { models: ["codex/gpt-5.6-luna"], imageModels: [], quotaPercent: 40 },
        },
      }),
    });
    const apiKeyRecord = await db.getApiKeyById(key.id);
    const usageByToken = {
      "token-1": [10, 49],
      "token-2": [10],
    };
    mocks.getCodexUsage.mockImplementation(async (token) => ({
      quotas: { session: quotaWindow(usageByToken[token].shift() ?? 10, resetAt) },
    }));

    const firstCredentials = { accessToken: "token-1", providerSpecificData: {} };
    await quota.checkApiKeyQuota({ apiKeyRecord, connectionId: first.id, provider: "codex", model: "gpt-5.6-luna", credentials: firstCredentials });
    await quota.recordApiKeyQuotaUsage({
      apiKeyRecord,
      connectionId: first.id,
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials: firstCredentials,
      usage: { prompt_tokens: 500, completion_tokens: 500 },
    });

    let releaseFirst;
    let markFirstStarted;
    const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
    const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
    const usedTokens = [];
    mocks.handleChatCore.mockImplementation(async ({ credentials }) => {
      usedTokens.push(credentials.accessToken);
      if (usedTokens.length === 1) {
        markFirstStarted();
        await firstBlocked;
      }
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const { handleChat } = await import("@/sse/handlers/chat.js");
    const makeRequest = () => new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "cx/gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
    });

    const firstResponsePromise = handleChat(makeRequest());
    await firstStarted;
    const secondResponse = await handleChat(makeRequest());

    expect(secondResponse.status).toBe(200);
    expect(usedTokens).toEqual(["token-1", "token-2"]);

    releaseFirst();
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(200);
  });

  it("returns 429 when a concurrent request has no other eligible assigned account", async () => {
    const { db, authorization, quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const connection = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "only", accessToken: "token" });
    const key = await db.createApiKey("limited", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: authorization.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          [connection.id]: { models: ["codex/gpt-5.6-luna"], imageModels: [], quotaPercent: 40 },
        },
      }),
    });
    const apiKeyRecord = await db.getApiKeyById(key.id);
    mocks.getCodexUsage
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(10, resetAt) } })
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(49, resetAt) } });
    const credentials = { accessToken: "token", providerSpecificData: {} };
    await quota.checkApiKeyQuota({ apiKeyRecord, connectionId: connection.id, provider: "codex", model: "gpt-5.6-luna", credentials });
    await quota.recordApiKeyQuotaUsage({
      apiKeyRecord,
      connectionId: connection.id,
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
      usage: { prompt_tokens: 500, completion_tokens: 500 },
    });

    let releaseFirst;
    let markFirstStarted;
    const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
    const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
    mocks.handleChatCore.mockImplementationOnce(async () => {
      markFirstStarted();
      await firstBlocked;
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const { handleChat } = await import("@/sse/handlers/chat.js");
    const makeRequest = () => new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "cx/gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
    });

    const firstResponsePromise = handleChat(makeRequest());
    await firstStarted;
    const secondResponse = await handleChat(makeRequest());

    expect(secondResponse.status).toBe(429);
    await expect(secondResponse.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("API key quota limit reached") },
    });
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);

    releaseFirst();
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(200);
  });

  it("releases an abandoned quota reservation so the account becomes eligible again", async () => {
    const { db, authorization, quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const key = await db.createApiKey("limited", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: authorization.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          "codex-a": { models: ["codex/gpt-5.6-luna"], imageModels: [], quotaPercent: 40 },
        },
      }),
    });
    const apiKeyRecord = await db.getApiKeyById(key.id);
    const credentials = { accessToken: "token", providerSpecificData: {} };
    mocks.getCodexUsage
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(10, resetAt) } })
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(49, resetAt) } });

    await quota.checkApiKeyQuota({ apiKeyRecord, connectionId: "codex-a", provider: "codex", model: "gpt-5.6-luna", credentials });
    await quota.recordApiKeyQuotaUsage({
      apiKeyRecord,
      connectionId: "codex-a",
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
      usage: { prompt_tokens: 500, completion_tokens: 500 },
    });

    const first = await quota.checkApiKeyQuota({
      apiKeyRecord,
      connectionId: "codex-a",
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
      reserve: true,
    });
    const blocked = await quota.checkApiKeyQuota({
      apiKeyRecord,
      connectionId: "codex-a",
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
      reserve: true,
    });

    expect(first.exceeded).toBe(false);
    expect(blocked.exceeded).toBe(true);

    await quota.releaseApiKeyQuotaReservation(first.reservation);
    await quota.releaseApiKeyQuotaReservation(first.reservation);

    const afterRelease = await quota.checkApiKeyQuota({
      apiKeyRecord,
      connectionId: "codex-a",
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
      reserve: true,
    });
    expect(afterRelease.exceeded).toBe(false);
    await quota.releaseApiKeyQuotaReservation(afterRelease.reservation);
  });

  it("falls back to the next assigned account when the first reaches the API-key limit", async () => {
    const { db, authorization, quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const first = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "first", accessToken: "token-1" });
    const second = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "second", accessToken: "token-2" });
    const key = await db.createApiKey("limited", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: authorization.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          [first.id]: { models: ["codex/gpt-5.6-luna"], imageModels: [], quotaPercent: 40 },
          [second.id]: { models: ["codex/gpt-5.6-luna"], imageModels: [], quotaPercent: 40 },
        },
      }),
    });
    const apiKeyRecord = await db.getApiKeyById(key.id);
    const usageByToken = {
      "token-1": [10, 50],
      "token-2": [10],
    };
    mocks.getCodexUsage.mockImplementation(async (token) => ({
      quotas: { session: quotaWindow(usageByToken[token].shift() ?? 10, resetAt) },
    }));

    await quota.checkApiKeyQuota({
      apiKeyRecord,
      connectionId: first.id,
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials: { accessToken: "token-1", providerSpecificData: {} },
    });
    await quota.recordApiKeyQuotaUsage({
      apiKeyRecord,
      connectionId: first.id,
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials: { accessToken: "token-1", providerSpecificData: {} },
      usage: { prompt_tokens: 500, completion_tokens: 500 },
    });

    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok", { status: 200 }) });
    const { handleChat } = await import("@/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "cx/gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.handleChatCore.mock.calls[0][0].credentials.accessToken).toBe("token-2");
    expect(mocks.logDebug).toHaveBeenCalledWith(
      "AUTH",
      expect.stringContaining("first | API key quota limit reached")
    );
    expect(mocks.logWarn).not.toHaveBeenCalledWith(
      "AUTH",
      expect.stringContaining("API key quota limit reached")
    );
  });

  it("returns 429 when every assigned account has reached the API-key limit", async () => {
    const { db, authorization, quota } = await setup();
    const resetAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const connection = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "only", accessToken: "token" });
    const key = await db.createApiKey("limited", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: authorization.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          [connection.id]: { models: ["codex/gpt-5.6-luna"], imageModels: [], quotaPercent: 25 },
        },
      }),
    });
    const apiKeyRecord = await db.getApiKeyById(key.id);
    mocks.getCodexUsage
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(10, resetAt) } })
      .mockResolvedValueOnce({ quotas: { session: quotaWindow(35, resetAt) } });
    const credentials = { accessToken: "token", providerSpecificData: {} };
    await quota.checkApiKeyQuota({ apiKeyRecord, connectionId: connection.id, provider: "codex", model: "gpt-5.6-luna", credentials });
    await quota.recordApiKeyQuotaUsage({
      apiKeyRecord,
      connectionId: connection.id,
      provider: "codex",
      model: "gpt-5.6-luna",
      credentials,
      usage: { prompt_tokens: 500, completion_tokens: 500 },
    });

    const { handleChat } = await import("@/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "cx/gpt-5.6-luna", messages: [{ role: "user", content: "hi" }] }),
    }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("API key quota limit reached") },
    });
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "CHAT",
      "No more accounts available",
      { provider: "codex" }
    );
  });
});
