import { beforeEach, describe, expect, it, vi } from "vitest";

// Coverage for the account-selection / combo-fallback loop described in
// CLAUDE.md as "the thing to understand first": src/sse/handlers/chat.js
// drives (a) a per-model account retry loop and (b) recurses into itself once
// per combo candidate via open-sse/services/combo.js's handleComboChat. This
// file exercises both loops together with mocked credentials/handleChatCore,
// no live provider calls.
//
// open-sse/services/combo.js is intentionally left un-mocked: it's the real
// candidate-iteration logic under test (part of #3702's priority #1 slice).

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
  handleAntigravityQuotaError: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: mocks.handleAntigravityQuotaError,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function chatRequest(body, headers = {}) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// getModelInfo in real code resolves aliases via the DB; here every candidate
// is already "provider/model" shaped so a plain split reproduces its output.
function parseAsModelInfo(modelStr) {
  const [provider, model] = modelStr.split("/");
  return { provider, model };
}

describe("chat.js account-selection loop (single model)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getModelInfo.mockImplementation(async (m) => parseAsModelInfo(m));
    mocks.getComboModels.mockResolvedValue(null);
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, creds) => creds);
  });

  it("falls back to the next account on a retryable failure and returns the second account's success", async () => {
    const credA = { connectionId: "conn-a", connectionName: "Acct A", accessToken: "tok-a" };
    const credB = { connectionId: "conn-b", connectionName: "Acct B", accessToken: "tok-b" };
    mocks.getProviderCredentials
      .mockResolvedValueOnce(credA)
      .mockResolvedValueOnce(credB);
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true, cooldownMs: 30000 });
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 500, error: "upstream boom", response: jsonResponse({ error: { message: "upstream boom" } }, 500) })
      .mockImplementationOnce(async (params) => {
        await params.onRequestSuccess();
        return { success: true, response: jsonResponse({ choices: [{ message: { content: "hi" } }] }) };
      });

    const res = await handleChat(chatRequest({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }));

    expect(res.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(2);

    // Second attempt excludes the first (failed) connection.
    const secondCallExcludeSet = mocks.getProviderCredentials.mock.calls[1][1];
    expect(secondCallExcludeSet.has("conn-a")).toBe(true);

    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith("conn-a", 500, "upstream boom", "openai", "gpt-4o", undefined);
    // onRequestSuccess clears the account that actually served the response (B), not A.
    expect(mocks.clearAccountError).toHaveBeenCalledWith("conn-b", expect.objectContaining({ connectionId: "conn-b" }), "gpt-4o");
  });

  it("stops immediately without trying another account when the fallback decision says not to", async () => {
    const credA = { connectionId: "conn-a", connectionName: "Acct A" };
    mocks.getProviderCredentials.mockResolvedValueOnce(credA);
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: false, cooldownMs: 0 });
    const failureResponse = jsonResponse({ error: { message: "malformed request" } }, 400);
    mocks.handleChatCore.mockResolvedValueOnce({ success: false, status: 400, error: "malformed request", response: failureResponse });

    const res = await handleChat(chatRequest({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }));

    expect(res).toBe(failureResponse);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(1);
  });

  it("surfaces an unavailableResponse once every account is rate-limited, using the last observed error/status", async () => {
    const credA = { connectionId: "conn-a", connectionName: "Acct A" };
    mocks.getProviderCredentials
      .mockResolvedValueOnce(credA)
      .mockResolvedValueOnce({
        allRateLimited: true,
        retryAfter: new Date(Date.now() + 45000).toISOString(),
        retryAfterHuman: "reset after 45s",
        lastError: "stale error from DB",
        lastErrorCode: 999,
      });
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true, cooldownMs: 30000 });
    mocks.handleChatCore.mockResolvedValueOnce({
      success: false, status: 429, error: "rate limited",
      response: jsonResponse({ error: { message: "rate limited" } }, 429),
    });

    const res = await handleChat(chatRequest({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }));
    const body = await res.json();

    // Uses the loop's own lastStatus/lastError (429/"rate limited") in preference
    // to the stale values on the allRateLimited sentinel.
    expect(res.status).toBe(429);
    expect(body.error.message).toContain("rate limited");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 404 immediately when the provider has no credentials configured at all", async () => {
    mocks.getProviderCredentials.mockResolvedValueOnce(null);

    const res = await handleChat(chatRequest({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }));

    expect(res.status).toBe(404);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("dispatches to chatCore with the refreshed credentials, not the pre-refresh ones", async () => {
    const stale = { connectionId: "conn-a", accessToken: "stale-token" };
    const refreshed = { connectionId: "conn-a", accessToken: "fresh-token" };
    mocks.getProviderCredentials.mockResolvedValueOnce(stale);
    mocks.checkAndRefreshToken.mockResolvedValueOnce(refreshed);
    mocks.handleChatCore.mockResolvedValueOnce({ success: true, response: jsonResponse({ ok: true }) });

    await handleChat(chatRequest({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }));

    const dispatchedCredentials = mocks.handleChatCore.mock.calls[0][0].credentials;
    expect(dispatchedCredentials.accessToken).toBe("fresh-token");
  });

  it("wires chatCore's onCredentialsRefreshed callback to persist the new token against the ORIGINAL connection", async () => {
    const original = { connectionId: "conn-a", accessToken: "old", providerSpecificData: { foo: "bar" } };
    mocks.getProviderCredentials.mockResolvedValueOnce(original);
    mocks.handleChatCore.mockImplementationOnce(async (params) => {
      await params.onCredentialsRefreshed({ accessToken: "rotated" });
      return { success: true, response: jsonResponse({ ok: true }) };
    });

    await handleChat(chatRequest({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }));

    expect(mocks.updateProviderCredentials).toHaveBeenCalledWith("conn-a", {
      accessToken: "rotated",
      existingProviderSpecificData: { foo: "bar" },
      testStatus: "active",
    });
  });
});

describe("chat.js combo fallback (multiple candidates, real open-sse/services/combo.js)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getModelInfo.mockImplementation(async (m) => parseAsModelInfo(m));
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, creds) => creds);
  });

  it("rolls to the next combo candidate once the first candidate exhausts its own accounts (regression class for #3619)", async () => {
    mocks.getComboModels.mockImplementation(async (m) => (m === "mixed-combo" ? ["vxp/model-a", "openrouter/model-b"] : null));

    mocks.getProviderCredentials
      .mockResolvedValueOnce({ connectionId: "conn-vxp", connectionName: "VXP" }) // vxp attempt 1
      .mockResolvedValueOnce(null)                                                // vxp: no more accounts
      .mockResolvedValueOnce({ connectionId: "conn-or", connectionName: "OpenRouter" }); // openrouter attempt 1

    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true, cooldownMs: 30000 });

    mocks.handleChatCore
      .mockResolvedValueOnce({
        success: false, status: 429, error: "rate limit exceeded",
        response: jsonResponse({ error: { message: "rate limit exceeded" } }, 429),
      })
      .mockResolvedValueOnce({ success: true, response: jsonResponse({ choices: [{ message: { content: "answer" } }] }) });

    const res = await handleChat(chatRequest({ model: "mixed-combo", messages: [{ role: "user", content: "hi" }] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.choices[0].message.content).toBe("answer");
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    expect(mocks.getModelInfo).toHaveBeenCalledWith("vxp/model-a");
    expect(mocks.getModelInfo).toHaveBeenCalledWith("openrouter/model-b");
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith("conn-vxp", 429, "rate limit exceeded", "vxp", "model-a", undefined);
  });

  it("returns a well-formed terminal error (never empty/hangs) when every combo candidate exhausts its accounts", async () => {
    mocks.getComboModels.mockImplementation(async (m) => (m === "mixed-combo" ? ["vxp/model-a", "openrouter/model-b"] : null));

    mocks.getProviderCredentials
      .mockResolvedValueOnce({ connectionId: "conn-vxp" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ connectionId: "conn-or" })
      .mockResolvedValueOnce(null);

    mocks.markAccountUnavailable
      .mockResolvedValueOnce({ shouldFallback: true, cooldownMs: 30000 })
      .mockResolvedValueOnce({ shouldFallback: true, cooldownMs: 30000 });

    mocks.handleChatCore
      .mockResolvedValueOnce({
        success: false, status: 500, error: "vxp translation error",
        response: jsonResponse({ error: { message: "vxp translation error" } }, 500),
      })
      .mockResolvedValueOnce({
        // Deliberately avoids any ERROR_RULES text match (e.g. "overloaded", "rate limit")
        // so this stays on the default-transient (30s, no-wait) path — a message like
        // "...overloaded" would hit combo.js's short-cooldown retry-with-wait branch and
        // add a real multi-second sleep to this test.
        success: false, status: 503, error: "openrouter had a bad response",
        response: jsonResponse({ error: { message: "openrouter had a bad response" } }, 503),
      });

    const res = await handleChat(chatRequest({ model: "mixed-combo", messages: [{ role: "user", content: "hi" }] }));
    const body = await res.json();

    // Every candidate failed, but the client still gets a real status + a non-empty
    // JSON error body — this is the contract a client like VS Code Copilot needs to
    // render an actual message instead of "Sorry, no response was returned" (#3619).
    expect(res.ok).toBe(false);
    expect(typeof res.status).toBe("number");
    expect(body.error.message).toBeTruthy();
    // Terminal status reflects the FIRST candidate's failure status, not the last —
    // current (documented, not asserted-as-ideal) behavior of open-sse/services/combo.js.
    expect(res.status).toBe(500);
    expect(body.error.message).toBe("openrouter had a bad response");
  });
});
