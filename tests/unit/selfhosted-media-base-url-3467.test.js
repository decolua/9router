/**
 * #3467 — self-hosted TTS/STT connections could not be pointed at another host.
 *
 * Both providers read their endpoint from `providerSpecificData.baseUrl`, and
 * both registry entries told the operator to "set providerSpecificData.baseUrl"
 * — but neither the Add nor the Edit connection form had a field for it, so a
 * connection created through the dashboard silently used the localhost default.
 * In Docker that address is the 9router container itself.
 *
 * The field is now registry-driven: a provider declares `connectionBaseUrl`,
 * `AI_PROVIDERS` carries it to the dashboard, and the form stores the value
 * under the key the runtime already reads. These tests pin each link of that
 * chain plus the merge helper the forms use.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import selfhostedTtsRegistry from "open-sse/providers/registry/selfhosted-tts.js";
import selfhostedSttRegistry from "open-sse/providers/registry/selfhosted-stt.js";
import selfhostedTts from "open-sse/handlers/ttsProviders/selfhostedTts.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { withConnectionBaseUrl } from "@/shared/utils/connectionBaseUrl";

describe("connectionBaseUrl registry declaration (#3467)", () => {
  for (const [id, entry] of [
    ["selfhosted-tts", selfhostedTtsRegistry],
    ["selfhosted-stt", selfhostedSttRegistry],
  ]) {
    it(`${id} declares a Base URL field with a placeholder`, () => {
      expect(entry.connectionBaseUrl).toBeTruthy();
      expect(entry.connectionBaseUrl.label).toBe("Base URL");
      expect(entry.connectionBaseUrl.placeholder).toMatch(/^https?:\/\//);
    });

    it(`${id} reaches the dashboard through AI_PROVIDERS`, () => {
      // The UI map is built from the registry with a field whitelist — a
      // declaration that is not whitelisted never renders.
      expect(AI_PROVIDERS[id]?.connectionBaseUrl).toEqual(entry.connectionBaseUrl);
    });

    it(`${id} keeps its localhost default for existing connections`, () => {
      const cfg = entry.ttsConfig || entry.sttConfig;
      expect(cfg.baseUrl).toMatch(/^http:\/\/localhost:\d+/);
    });
  }

  it("does not add the field to providers that did not ask for it", () => {
    expect(AI_PROVIDERS.openai?.connectionBaseUrl).toBeUndefined();
    expect(AI_PROVIDERS["ollama-local"]?.connectionBaseUrl).toBeUndefined();
  });
});

describe("withConnectionBaseUrl", () => {
  it("stores a trimmed baseUrl", () => {
    expect(withConnectionBaseUrl(undefined, "  http://tts:8880 ")).toEqual({
      baseUrl: "http://tts:8880",
    });
  });

  it("keeps the keys the form does not own", () => {
    const existing = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy:3128" };
    expect(withConnectionBaseUrl(existing, "http://tts:8880")).toEqual({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy:3128",
      baseUrl: "http://tts:8880",
    });
  });

  it("clearing the field removes only baseUrl, so the provider default applies", () => {
    const existing = { baseUrl: "http://old:8880", connectionProxyEnabled: false };
    expect(withConnectionBaseUrl(existing, "   ")).toEqual({ connectionProxyEnabled: false });
  });

  it("returns undefined when nothing is left to store", () => {
    expect(withConnectionBaseUrl(undefined, "")).toBeUndefined();
    expect(withConnectionBaseUrl({ baseUrl: "http://old:8880" }, "")).toBeUndefined();
  });

  it("does not mutate the connection's stored object", () => {
    const existing = { baseUrl: "http://old:8880" };
    withConnectionBaseUrl(existing, "http://new:8880");
    expect(existing).toEqual({ baseUrl: "http://old:8880" });
  });
});

describe("the stored key is the one the runtime reads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("self-hosted TTS posts to the connection's baseUrl", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url) => {
      calls.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    });

    const providerSpecificData = withConnectionBaseUrl(undefined, "http://tts-host:8880");
    await selfhostedTts.synthesize("hello", "kokoro", { apiKey: "local", providerSpecificData });

    expect(calls).toEqual(["http://tts-host:8880/v1/audio/speech"]);
  });

  it("falls back to the localhost default when the field is empty", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url) => {
      calls.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    });

    await selfhostedTts.synthesize("hello", "kokoro", {
      apiKey: "local",
      providerSpecificData: withConnectionBaseUrl(undefined, ""),
    });

    expect(calls).toEqual(["http://localhost:8880/v1/audio/speech"]);
  });
});
