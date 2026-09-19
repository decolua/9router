/**
 * F12 (audit T1.8 F5) — the tts/stt account-fallback loops must have the same
 * token-refresh + account-recovery discipline the chat/embeddings/image/video
 * loops already have.
 *
 * Reference wiring (verified paths):
 *   src/sse/handlers/chat.js:306                    checkAndRefreshToken(provider, credentials)
 *   src/sse/handlers/chat.js:441 (onRequestSuccess) clearAccountError(connectionId, credentials, model)
 *   src/sse/handlers/embeddings.js:120 / :134       same, per attempt
 *   src/sse/handlers/imageGeneration.js:108, videoGeneration.js:149
 * Before this task tts.js:87-114 and stt.js:60-87 passed the RAW credentials
 * straight to the core and never cleared the account error on success, so an
 * expired OAuth connection 401'd forever and stayed marked unavailable even
 * after later successes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(async () => null),
  checkAndRefreshToken: vi.fn(async (_p, creds) => ({ ...creds, accessToken: "refreshed-token" })),
  updateProviderCredentials: vi.fn(async () => {}),
  handleTtsCore: vi.fn(),
  handleSttCore: vi.fn(),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getComboByName: mocks.getComboByName,
  getCombos: mocks.getCombos,
  getProviderConnectionById: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), maskKey: vi.fn(() => "masked"),
}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("open-sse/handlers/ttsCore.js", () => ({
  handleTtsCore: mocks.handleTtsCore,
  VOICE_FETCHERS: {},
  fetchEdgeTtsVoices: vi.fn(),
  fetchLocalDeviceVoices: vi.fn(),
  fetchElevenLabsVoices: vi.fn(),
}));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: mocks.handleSttCore }));

import { handleTts } from "@/sse/handlers/tts.js";
import { handleStt } from "@/sse/handlers/stt.js";

const account = (id, name) => ({
  connectionId: id,
  connectionName: name,
  apiKey: "sk-upstream",
  accessToken: "stale-token",
  _connection: { testStatus: "unavailable", lastError: "401 from earlier" },
});

const ttsRequest = () =>
  new Request("http://localhost/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-4o-mini-tts", input: "say this", voice: "alloy" }),
  });

const sttRequest = async () => {
  const fd = new FormData();
  fd.append("model", "deepgram/nova-2");
  fd.append("file", new Blob([new Uint8Array(1024)], { type: "audio/wav" }), "a.wav");
  return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: fd });
};

const TTS_MODEL = { provider: "openai", model: "gpt-4o-mini-tts" };
const STT_MODEL = { provider: "deepgram", model: "nova-2" };

const okTts = () => ({ success: true, response: new Response(new Uint8Array(16), { headers: { "Content-Type": "audio/mpeg" } }) });
const okStt = () => ({ success: true, response: Response.json({ text: "transcript body" }) });
const unauthorized = () => ({ success: false, status: 401, error: "Invalid API key" });

const SPECS = [
  {
    name: "tts",
    model: TTS_MODEL,
    core: mocks.handleTtsCore,
    run: () => handleTts(ttsRequest()),
    ok: okTts,
  },
  {
    name: "stt",
    model: STT_MODEL,
    core: mocks.handleSttCore,
    run: () => sttRequest().then((r) => handleStt(r)),
    ok: okStt,
  },
];

describe.each(SPECS)("$name fallback loop (chat parity)", (spec) => {
  // Once-queue: each attempt in the fallback loop pops the next queued result.
  const queue = (value) => spec.core.mockResolvedValueOnce(value);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ ...spec.model });
    mocks.getProviderCredentials.mockResolvedValue(account("conn-1", "Account One"));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    mocks.checkAndRefreshToken.mockImplementation(async (_p, creds) => ({ ...creds, accessToken: "refreshed-token" }));
    mocks.clearAccountError.mockResolvedValue(undefined);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it("refreshes the token once per attempt and hands the refreshed credentials to the core", async () => {
    queue(spec.ok());

    const res = await spec.run();
    expect(res.status).toBe(200);

    expect(mocks.checkAndRefreshToken).toHaveBeenCalledTimes(1);
    expect(mocks.checkAndRefreshToken).toHaveBeenCalledWith(
      spec.model.provider,
      expect.objectContaining({ connectionId: "conn-1" })
    );
    expect(spec.core).toHaveBeenCalledTimes(1);
    expect(spec.core.mock.calls[0][0].credentials).toMatchObject({
      accessToken: "refreshed-token",
      connectionId: "conn-1",
    });
  });

  it("clears the account error on success (a recovered account stops looking down)", async () => {
    queue(spec.ok());

    await spec.run();

    expect(mocks.clearAccountError).toHaveBeenCalledTimes(1);
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ connectionId: "conn-1" }),
      spec.model.model
    );
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("a 401 attempt refreshes exactly once, keeps the response, and does NOT clear the account error", async () => {
    queue(unauthorized());

    const res = await spec.run();
    expect(res.status).toBe(401);

    expect(mocks.checkAndRefreshToken).toHaveBeenCalledTimes(1);
    expect(mocks.clearAccountError).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "conn-1", 401, "Invalid API key", spec.model.provider, spec.model.model
    );
  });

  it("rotating to a second account refreshes once per account and clears only the winner", async () => {
    mocks.getProviderCredentials
      .mockResolvedValueOnce(account("conn-1", "Account One"))
      .mockResolvedValueOnce(account("conn-2", "Account Two"));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    queue(unauthorized());
    queue(spec.ok());

    const res = await spec.run();
    expect(res.status).toBe(200);

    expect(mocks.checkAndRefreshToken).toHaveBeenCalledTimes(2);
    expect(mocks.clearAccountError).toHaveBeenCalledTimes(1);
    expect(mocks.clearAccountError.mock.calls[0][0]).toBe("conn-2");
  });

  it("a refresh failure degrades to the stored credentials instead of breaking the request", async () => {
    mocks.checkAndRefreshToken.mockRejectedValue(new Error("refresh blew up"));
    queue(spec.ok());

    const res = await spec.run();
    expect(res.status).toBe(200);
    expect(spec.core.mock.calls[0][0].credentials).toMatchObject({ accessToken: "stale-token" });
  });
});
