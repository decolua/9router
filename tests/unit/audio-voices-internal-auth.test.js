import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ edge: vi.fn(), local: vi.fn(), eleven: vi.fn() }));
vi.mock("open-sse/handlers/ttsCore.js", () => ({
  VOICE_FETCHERS: { "edge-tts": mocks.edge, "local-device": mocks.local, elevenlabs: mocks.eleven },
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireLogin: true }),
  validateApiKey: async (key) => key === "valid-router-key",
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "internal-cli-key" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async () => false }));

import { proxy } from "@/dashboardGuard.js";
import { GET as publicVoices } from "@/app/api/v1/audio/voices/route.js";
import { GET as dashboardVoices } from "@/app/api/media-providers/tts/voices/route.js";

async function remoteVoices(query, key = "valid-router-key") {
  const request = new NextRequest(`https://router.example/v1/audio/voices?${query}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  const gate = await proxy(request);
  return gate.headers.get("x-middleware-next") === "1" ? publicVoices(request) : gate;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.edge.mockResolvedValue([
    { ShortName: "zh-CN-XiaoxiaoNeural", FriendlyName: "Xiaoxiao", Locale: "zh-CN", Gender: "Female" },
    { ShortName: "en-US-JennyNeural", FriendlyName: "Jenny", Locale: "en-US", Gender: "Female" },
  ]);
  mocks.local.mockResolvedValue([
    { id: "local-voice", name: "Local", locale: "en_US", lang: "en", country: "US", gender: "Female" },
  ]);
  mocks.eleven.mockResolvedValue([{ voice_id: "v1", name: "Example", labels: { language: "en", gender: "male" } }]);
  // Exercise the real dashboard guard on any server self-fetch. API credentials
  // do not grant a dashboard session, even when the outer /v1 call is authorized.
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const request = new NextRequest(url, options);
    const gate = await proxy(request);
    return gate.headers.get("x-middleware-next") === "1" ? dashboardVoices(request) : gate;
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("public no-auth voice listing (#1551)", () => {
  it("lists Edge voices with a router API key while dashboard login is required", async () => {
    const res = await remoteVoices("provider=edge-tts&lang=zh");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ object: "list", data: [
      { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao", lang: "zh", gender: "Female", model: "edge-tts/zh-CN-XiaoxiaoNeural" },
    ] });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(mocks.edge).toHaveBeenCalledWith();
  });

  it("lists all languages when no language filter is supplied", async () => {
    const res = await remoteVoices("provider=edge-tts");
    expect(res.status).toBe(200);
    expect((await res.json()).data.map((voice) => voice.id)).toEqual(["zh-CN-XiaoxiaoNeural", "en-US-JennyNeural"]);
  });

  it("lists local-device voices through the same public API", async () => {
    const res = await remoteVoices("provider=local-device&lang=en");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ object: "list", data: [
      { id: "local-voice", name: "Local", lang: "en", gender: "Female", model: "local-device/local-voice" },
    ] });
  });

  it("returns the voice provider's failure without turning it into a dashboard 401", async () => {
    mocks.edge.mockRejectedValueOnce(new Error("Edge voices unavailable"));
    const res = await remoteVoices("provider=edge-tts");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { message: "Edge voices unavailable", type: "server_error" } });
  });

  it("continues to require an API key for remote public requests", async () => {
    const res = await remoteVoices("provider=edge-tts", "invalid");
    expect(res.status).toBe(401);
    expect(mocks.edge).not.toHaveBeenCalled();
  });

  it("does not grant dashboard access to a router API key", async () => {
    const res = await proxy(new NextRequest("https://router.example/api/media-providers/tts/voices?provider=edge-tts", {
      headers: { Authorization: "Bearer valid-router-key" },
    }));
    expect(res.status).toBe(401);
  });

  it("keeps the dashboard voice shape and language filter", async () => {
    const res = await dashboardVoices(new Request("https://router.example/api/media-providers/tts/voices?provider=local-device&lang=en"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voices[0]).toMatchObject({ id: "local-voice", locale: "en-US", countryName: "United States", langName: "English" });
    expect(body.byLang.en.voices).toEqual(body.voices);
    expect(body.languages[0].code).toBe("en");
  });

  it("keeps API-key forwarding for the existing ElevenLabs dashboard fetcher", async () => {
    const res = await dashboardVoices(new Request("https://router.example/api/media-providers/tts/voices?provider=elevenlabs&apiKey=eleven-key"));
    expect(res.status).toBe(200);
    expect((await res.json()).voices[0]).toMatchObject({ id: "v1", name: "Example", lang: "en" });
    expect(mocks.eleven).toHaveBeenCalledWith("eleven-key");
  });
});
