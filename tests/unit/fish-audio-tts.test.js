import { beforeEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

const AUDIO = new Uint8Array(256).fill(7);

function okResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "audio/mpeg" }),
    arrayBuffer: async () => AUDIO.buffer,
  };
}

describe("Fish Audio TTS provider", () => {
  const entry = REGISTRY.find((e) => e.id === "fish-audio");

  it("is registered as a TTS-only apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.serviceKinds).toEqual(["tts"]);
    expect(PROVIDER_MEDIA["fish-audio"]?.ttsConfig?.baseUrl).toBe("https://api.fish.audio/v1/tts");
  });

  it("is visible to the generic dispatcher, which reads AI_PROVIDERS", () => {
    // synthesizeViaConfig() looks the provider up here, not in PROVIDER_MEDIA.
    expect(AI_PROVIDERS["fish-audio"]?.ttsConfig?.format).toBe("fish-audio");
    expect(typeof FORMAT_HANDLERS["fish-audio"]).toBe("function");
  });

  it("exposes the four documented models", () => {
    const ids = (entry.ttsConfig.models || []).map((m) => m.id);
    expect(ids).toEqual(["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1"]);
  });

  it("keeps registry ids and aliases unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const aliases = REGISTRY.map((e) => e.alias).filter(Boolean);
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});

describe("Fish Audio TTS request shape", () => {
  const handler = FORMAT_HANDLERS["fish-audio"];
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => okResponse());
    global.fetch = fetchMock;
  });

  const callArgs = () => {
    const [url, init] = fetchMock.mock.calls.at(-1);
    return { url, init, body: JSON.parse(init.body) };
  };

  it("sends the model as an HTTP header, not in the body", async () => {
    await handler({
      baseUrl: "https://api.fish.audio/v1/tts",
      apiKey: "sk-test",
      text: "xin chào",
      modelId: "s1",
      voiceId: "",
    });

    const { url, init, body } = callArgs();
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(init.headers.model).toBe("s1");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(body).toEqual({ text: "xin chào", format: "mp3" });
  });

  it("maps the voice onto reference_id, and omits it when unset", async () => {
    await handler({ baseUrl: "u", apiKey: "k", text: "t", modelId: "s1", voiceId: "voice-abc" });
    expect(callArgs().body.reference_id).toBe("voice-abc");

    await handler({ baseUrl: "u", apiKey: "k", text: "t", modelId: "s1", voiceId: "" });
    expect(callArgs().body).not.toHaveProperty("reference_id");
  });

  it("defaults to the free model when none is given", async () => {
    await handler({ baseUrl: "u", apiKey: "k", text: "t", modelId: "", voiceId: "" });
    expect(callArgs().init.headers.model).toBe("s2.1-pro-free");
  });

  it("returns base64 audio with its format", async () => {
    const out = await handler({ baseUrl: "u", apiKey: "k", text: "t", modelId: "s1", voiceId: "" });
    expect(out.format).toBe("mp3");
    expect(typeof out.base64).toBe("string");
    expect(out.base64.length).toBeGreaterThan(0);
  });

  it("surfaces the upstream error message", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ message: "Insufficient credit" }),
    }));

    await expect(
      handler({ baseUrl: "u", apiKey: "k", text: "t", modelId: "s1", voiceId: "" }),
    ).rejects.toThrow("Insufficient credit");
  });
});
