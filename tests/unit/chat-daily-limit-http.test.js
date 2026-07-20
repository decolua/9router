import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  clearAccountError: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));
const modelMocks = vi.hoisted(() => ({
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
}));
const dispatchMocks = vi.hoisted(() => ({
  handleChatCore: vi.fn(),
}));
const tokenMocks = vi.hoisted(() => ({
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", async (importOriginal) => ({
  ...await importOriginal(),
  clearAccountError: authMocks.clearAccountError,
  getProviderCredentials: authMocks.getProviderCredentials,
  markAccountUnavailable: authMocks.markAccountUnavailable,
}));
vi.mock("@/sse/services/model.js", () => modelMocks);
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => tokenMocks);

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let apiKey;
let db;
let limitedApiKey;
let rawDb;
let unlimitedApiKey;
let postChat;

function credentials(id = "connection-test") {
  return {
    connectionId: id,
    connectionName: id,
    authType: "apikey",
    apiKey: "provider-key",
    providerSpecificData: {},
  };
}

function successResult(content = "ok") {
  return {
    success: true,
    response: new Response(JSON.stringify({
      id: "chat-test",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

function failureResult(status = 400, error = "upstream failed") {
  return {
    success: false,
    status,
    error,
    response: new Response(JSON.stringify({ error: { message: error } }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chat-limit-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ instance: rawDb } = global._dbAdapter);
  apiKey = await db.createApiKey("exhausted-key", "machine-test", 100);
  limitedApiKey = await db.createApiKey("limited-key", "machine-test", 1_000_000);
  unlimitedApiKey = await db.createApiKey("unlimited-key", "machine-test");
  await db.saveRequestUsage({
    provider: "openai",
    model: "gpt-4o",
    apiKey: apiKey.key,
    tokens: { prompt_tokens: 60, completion_tokens: 30, reasoning_tokens: 20 },
  });
  rawDb.exec(`
    CREATE TABLE reservationAudit(action TEXT NOT NULL, reservationId TEXT NOT NULL);
    CREATE TRIGGER audit_reservation_insert AFTER INSERT ON apiKeyUsageReservations
      BEGIN INSERT INTO reservationAudit(action, reservationId) VALUES('insert', NEW.id); END;
    CREATE TRIGGER audit_reservation_delete AFTER DELETE ON apiKeyUsageReservations
      BEGIN INSERT INTO reservationAudit(action, reservationId) VALUES('delete', OLD.id); END;
  `);

  ({ POST: postChat } = await import("@/app/api/v1/chat/completions/route.js"));
});

afterAll(() => {
  try { rawDb?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  vi.clearAllMocks();
  authMocks.clearAccountError.mockReset().mockResolvedValue(undefined);
  authMocks.getProviderCredentials.mockReset().mockResolvedValue(credentials());
  authMocks.markAccountUnavailable.mockReset().mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
  modelMocks.getComboModels.mockReset().mockResolvedValue(null);
  modelMocks.getModelInfo.mockReset().mockImplementation(async (modelStr) => {
    const [provider, ...modelParts] = modelStr.split("/");
    return { provider, model: modelParts.join("/") };
  });
  dispatchMocks.handleChatCore.mockReset().mockResolvedValue(successResult());
  tokenMocks.checkAndRefreshToken.mockReset().mockImplementation(async (_provider, value) => value);
  tokenMocks.updateProviderCredentials.mockReset().mockResolvedValue(undefined);
  rawDb.run("DELETE FROM apiKeyUsageReservations");
  rawDb.run("DELETE FROM reservationAudit");
  await db.updateSettings({ comboStrategy: "fallback", comboStrategies: {} });
});

describe("POST /v1/chat/completions daily token admission", () => {
  it("returns 429 after model resolution but before account selection or upstream dispatch", async () => {
    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        message: "API key daily token limit exceeded (110/100 tokens)",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    });
    expect(modelMocks.getComboModels).toHaveBeenCalledWith("openai/gpt-4o");
    expect(modelMocks.getModelInfo).toHaveBeenCalledWith("openai/gpt-4o");
    expect(authMocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(dispatchMocks.handleChatCore).not.toHaveBeenCalled();
    expect(rawDb.get("SELECT COUNT(*) AS count FROM reservationAudit").count).toBe(0);
  });

  it("allows an unlimited active key to reach account selection and dispatch", async () => {
    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${unlimitedApiKey.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(200);
    expect(modelMocks.getComboModels).toHaveBeenCalledWith("openai/gpt-4o");
    expect(modelMocks.getModelInfo).toHaveBeenCalledWith("openai/gpt-4o");
    expect(authMocks.getProviderCredentials).toHaveBeenCalledWith("openai", expect.any(Set), "gpt-4o");
    expect(dispatchMocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: unlimitedApiKey.key,
      credentials: expect.objectContaining({ connectionId: "connection-test" }),
      usageReservationId: null,
    }));
    expect(rawDb.get("SELECT COUNT(*) AS count FROM reservationAudit").count).toBe(0);
  });

  it("reserves a limited request and forwards its ID to chat core", async () => {
    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${limitedApiKey.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(200);
    const usageReservationId = dispatchMocks.handleChatCore.mock.calls[0][0].usageReservationId;
    expect(usageReservationId).toEqual(expect.any(String));
    expect(rawDb.all("SELECT id FROM apiKeyUsageReservations")).toEqual([{ id: usageReservationId }]);
    expect(rawDb.all("SELECT action FROM reservationAudit")).toEqual([{ action: "insert" }]);
  });

  it("reuses one reservation across account fallback", async () => {
    authMocks.getProviderCredentials
      .mockResolvedValueOnce(credentials("connection-one"))
      .mockResolvedValueOnce(credentials("connection-two"));
    authMocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true, cooldownMs: 1_000 });
    dispatchMocks.handleChatCore
      .mockResolvedValueOnce(failureResult(429, "rate limited"))
      .mockResolvedValueOnce(successResult());

    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${limitedApiKey.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(200);
    expect(dispatchMocks.handleChatCore).toHaveBeenCalledTimes(2);
    const reservationIds = dispatchMocks.handleChatCore.mock.calls.map(([options]) => options.usageReservationId);
    expect(reservationIds[0]).toEqual(expect.any(String));
    expect(reservationIds[1]).toBe(reservationIds[0]);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(1);
    expect(rawDb.all("SELECT action FROM reservationAudit")).toEqual([{ action: "insert" }]);
  });

  it("uses a fresh reservation for each fallback-combo model", async () => {
    modelMocks.getComboModels.mockImplementation(async (modelStr) => (
      modelStr === "fallback-combo" ? ["openai/model-one", "openai/model-two"] : null
    ));
    dispatchMocks.handleChatCore.mockImplementation(async ({ modelInfo }) => (
      modelInfo.model === "model-one" ? failureResult(429, "rate limited") : successResult()
    ));

    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${limitedApiKey.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "fallback-combo", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(200);
    const reservationIds = dispatchMocks.handleChatCore.mock.calls.map(([options]) => options.usageReservationId);
    expect(reservationIds).toHaveLength(2);
    expect(new Set(reservationIds).size).toBe(2);
    expect(rawDb.all("SELECT action FROM reservationAudit")).toEqual([
      { action: "insert" },
      { action: "delete" },
      { action: "insert" },
    ]);
  });

  it("reserves fusion panels and judge independently", async () => {
    await db.updateSettings({ comboStrategy: "fusion" });
    modelMocks.getComboModels.mockImplementation(async (modelStr) => (
      modelStr === "fusion-combo" ? ["openai/panel-one", "openai/panel-two"] : null
    ));
    dispatchMocks.handleChatCore.mockImplementation(async ({ modelInfo }) => successResult(`answer from ${modelInfo.model}`));

    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${limitedApiKey.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "fusion-combo", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(200);
    const reservationIds = dispatchMocks.handleChatCore.mock.calls.map(([options]) => options.usageReservationId);
    expect(reservationIds).toHaveLength(3);
    expect(new Set(reservationIds).size).toBe(3);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(3);
    expect(rawDb.all("SELECT action FROM reservationAudit")).toEqual([
      { action: "insert" },
      { action: "insert" },
      { action: "insert" },
    ]);
  });

  it("releases a reservation on terminal pre-upstream failure", async () => {
    authMocks.getProviderCredentials.mockResolvedValue(null);

    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${limitedApiKey.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(404);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
    expect(rawDb.all("SELECT action FROM reservationAudit")).toEqual([
      { action: "insert" },
      { action: "delete" },
    ]);
  });

  it("releases a reservation on terminal upstream failure", async () => {
    dispatchMocks.handleChatCore.mockResolvedValue(failureResult());

    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${limitedApiKey.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [], max_tokens: 1 }),
    }));

    expect(response.status).toBe(400);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
    expect(rawDb.all("SELECT action FROM reservationAudit")).toEqual([
      { action: "insert" },
      { action: "delete" },
    ]);
  });
});
