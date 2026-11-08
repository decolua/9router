import { describe, expect, it } from "vitest";
import { isChatModel, modelIdOf, partitionChatModels } from "../../src/lib/providerModels/classify.js";

describe("provider model classification", () => {
  it("reads an id from every shape providers use", () => {
    expect(modelIdOf("gpt-4o")).toBe("gpt-4o");
    expect(modelIdOf({ id: "gpt-4o" })).toBe("gpt-4o");
    expect(modelIdOf({ name: "llama-3" })).toBe("llama-3");
    expect(modelIdOf({ model: "mixtral" })).toBe("mixtral");
    expect(modelIdOf({ slug: "sonnet" })).toBe("sonnet");
    expect(modelIdOf({})).toBe(null);
    expect(modelIdOf(null)).toBe(null);
  });

  it("keeps ordinary chat models", () => {
    for (const id of ["gpt-4o", "claude-sonnet-5", "llama-3.1-70b", "deepseek-chat", "qwen-max"]) {
      expect(isChatModel(id), id).toBe(true);
    }
  });

  it("drops non-chat models a catalog mixes in", () => {
    for (const id of [
      "text-embedding-3-large",
      "whisper-1",
      "tts-1-hd",
      "dall-e-3",
      "omni-moderation-latest",
      "gpt-image-1",
      "bge-reranker-v2",
    ]) {
      expect(isChatModel(id), id).toBe(false);
    }
  });

  it("trusts a provider's own type over the id patterns", () => {
    // Nothing in this id says "embedding", but the provider says so.
    expect(isChatModel({ id: "nomic-v1.5", type: "embedding" })).toBe(false);
    expect(isChatModel({ id: "voice-alpha", kind: "tts" })).toBe(false);
    expect(isChatModel({ id: "gpt-4o", type: "chat" })).toBe(true);
  });

  it("does not treat OpenAI's generic object:'model' as a type signal", () => {
    // Every OpenAI entry carries object:"model"; it must not override patterns.
    expect(isChatModel({ id: "text-embedding-3-small", object: "model" })).toBe(false);
    expect(isChatModel({ id: "gpt-4o", object: "model" })).toBe(true);
  });

  it("partitions a mixed catalog and drops entries with no id", () => {
    const { chat, other } = partitionChatModels([
      { id: "gpt-4o" },
      { id: "text-embedding-3-small" },
      { id: "whisper-1" },
      { id: "claude-sonnet-5" },
      { nothing: true },
    ]);

    expect(chat.map((m) => m.id)).toEqual(["gpt-4o", "claude-sonnet-5"]);
    expect(other.map((m) => m.id)).toEqual(["text-embedding-3-small", "whisper-1"]);
  });

  it("handles an empty or missing catalog", () => {
    expect(partitionChatModels([])).toEqual({ chat: [], other: [] });
    expect(partitionChatModels(null)).toEqual({ chat: [], other: [] });
  });
});
