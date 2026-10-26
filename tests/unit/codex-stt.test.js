import { describe, it, expect } from "vitest";
import codex from "../../open-sse/providers/registry/codex.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

describe("Codex OAuth STT", () => {
  it("registers a transcription model alongside existing chat and image models", () => {
    expect(codex.serviceKinds).toContain("stt");
    expect(codex.models.find((m) => m.id === "transcribe")).toMatchObject({ kind: "stt", params: ["response_format"], responseFormats: ["json", "text"] });
    expect(codex.serviceKinds).toEqual(expect.arrayContaining(["llm", "image"]));
  });
  it("rejects API keys rather than sending them as ChatGPT OAuth", async () => {
    const formData = new FormData();
    formData.set("file", new File(["audio"], "audio.wav", { type: "audio/wav" }));
    const result = await handleSttCore({ provider: "codex", model: "transcribe", formData, credentials: { apiKey: "test-key" }, sttConfig: codex.sttConfig });
    expect(result.status).toBe(401);
    expect(result.error).toContain("OAuth");
  });
});
