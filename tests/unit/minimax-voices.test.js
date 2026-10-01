import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(),
}));

import { getProviderConnections } from "../../src/lib/localDb.js";
import { GET } from "../../src/app/api/media-providers/tts/minimax/voices/route.js";

const originalFetch = global.fetch;

describe("MiniMax voices API", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches global MiniMax voices with stored API key", async () => {
    getProviderConnections.mockResolvedValueOnce([{ apiKey: "test-key" }]);
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          system_voice: [
            { voice_id: "English_expressive_narrator", voice_name: "Expressive Narrator" },
            { voice_id: "Chinese (Mandarin)_female_beijing", voice_name: "Female Beijing" },
          ],
          voice_cloning: [{ voice_id: "clone_123", voice_name: "My Voice" }],
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await GET(new Request("http://localhost/api/media-providers/tts/minimax/voices"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getProviderConnections).toHaveBeenCalledWith({ provider: "minimax", isActive: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.minimax.io/v1/get_voice",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ voice_type: "all" }),
      })
    );
    expect(body.byLang.English.voices[0].id).toBe("English_expressive_narrator");
    expect(body.byLang["Chinese (Mandarin)"].voices[0].id).toBe("Chinese (Mandarin)_female_beijing");
    expect(body.byLang.Custom.voices[0]).toMatchObject({
      id: "clone_123",
      name: "My Voice · Cloned",
      category: "voice_cloning",
    });
  });

  it("fetches China MiniMax voices when provider=minimax-cn", async () => {
    getProviderConnections.mockResolvedValueOnce([{ apiKey: "test-key" }]);
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          system_voice: [{ voice_id: "Chinese (Mandarin)_female_beijing", voice_name: "Female Beijing" }],
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await GET(new Request("http://localhost/api/media-providers/tts/minimax/voices?provider=minimax-cn"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getProviderConnections).toHaveBeenCalledWith({ provider: "minimax-cn", isActive: true });
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.minimaxi.com/v1/get_voice");
    expect(body.byLang["Chinese (Mandarin)"].voices[0].id).toBe("Chinese (Mandarin)_female_beijing");
  });
});
