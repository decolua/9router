// SenseNova China vs international site split.
//
// Keys are per-site: token.sensenova.cn answers an international key with
// 401 {"error":{"code":16,"message":"Forbidden"}}, while token.sensenova.ai
// accepts it. China accounts stay on `sensenova`; international accounts use
// `sensenova-intl`. Each entry owns a fixed host — no user-supplied base URL.
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { openAICompletionToClaudeMessage } from "../../open-sse/translator/concerns/claudeMessage.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { CLAUDE_BLOCK } from "../../open-sse/translator/schema/index.js";

const CN = "sensenova";
const INTL = "sensenova-intl";
const CN_HOST = "token.sensenova.cn";
const INTL_HOST = "token.sensenova.ai";

const host = (url) => new URL(url).host;

async function drain(stream) {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

function sseStream(events) {
  const encoder = new TextEncoder();
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

const dataEvents = (text) => text
  .split("\n")
  .filter((l) => l.startsWith("data: ") && l.slice(6).trim() !== "[DONE]")
  .map((l) => JSON.parse(l.slice(6)));

describe("SenseNova site split", () => {
  it("registers both sites as OpenAI-compatible apikey providers with unique ids", () => {
    for (const id of [CN, INTL]) {
      const entry = REGISTRY.find((e) => e.id === id);
      expect(entry, id).toBeDefined();
      expect(entry.category).toBe("apikey");
      expect(PROVIDERS[id].format).toBe("openai");
    }
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps China on token.sensenova.cn for chat, validation and images", () => {
    expect(host(PROVIDERS[CN].baseUrl)).toBe(CN_HOST);
    expect(host(PROVIDERS[CN].validateUrl)).toBe(CN_HOST);
    expect(host(PROVIDER_MEDIA[CN].imageConfig.baseUrl)).toBe(CN_HOST);
  });

  it("routes the international site to token.sensenova.ai for chat, validation and images", () => {
    expect(PROVIDERS[INTL].baseUrl).toBe(`https://${INTL_HOST}/v1/chat/completions`);
    expect(PROVIDERS[INTL].validateUrl).toBe(`https://${INTL_HOST}/v1/models`);
    expect(PROVIDER_MEDIA[INTL].imageConfig.baseUrl).toBe(`https://${INTL_HOST}/v1/images/generations`);
  });

  it("builds the chat URL from the registry host, ignoring providerSpecificData.baseUrl", () => {
    const creds = { apiKey: "k", providerSpecificData: { baseUrl: "https://evil.example/v1" } };
    expect(getExecutor(INTL)).toBeInstanceOf(DefaultExecutor);
    expect(host(getExecutor(INTL).buildUrl("sensenova-6.8-flash", true, 0, creds))).toBe(INTL_HOST);
    expect(host(getExecutor(CN).buildUrl("sensenova-6.8-flash", true, 0, creds))).toBe(CN_HOST);
  });

  it("points each image adapter at its own site", () => {
    expect(host(getImageAdapter(INTL).buildUrl("sensenova-u1.5-lite", { apiKey: "k" }))).toBe(INTL_HOST);
    expect(host(getImageAdapter(CN).buildUrl("sensenova-u1.5-lite", { apiKey: "k" }))).toBe(CN_HOST);
  });

  it("lists the international catalog, including 6.7 Flash Lite and U1 Fast", () => {
    const models = PROVIDER_MODELS[INTL];
    const chat = models.filter((m) => (m.kind || "llm") === "llm").map((m) => m.id);
    const image = models.filter((m) => m.kind === "image").map((m) => m.id);
    expect(chat).toEqual(["sensenova-6.8-flash", "sensenova-6.8-flash-lite", "sensenova-6.7-flash-lite"]);
    expect(image).toEqual(["sensenova-u1.5-lite", "sensenova-u1-fast"]);
  });

  it("leaves the China catalog intact", () => {
    const ids = PROVIDER_MODELS[CN].map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([
      "sensenova-6.8-flash", "sensenova-6.8-flash-lite", "sensenova-u1.5-lite",
      "sensenova-u1.5-fast", "deepseek-flash", "glm-5.3", "kimi-k3",
    ]));
  });

  it("uses intl endpoint limits for intl chat models without touching China values", () => {
    for (const model of ["sensenova-6.8-flash", "sensenova-6.8-flash-lite", "sensenova-6.7-flash-lite"]) {
      expect(getCapabilitiesForModel(INTL, model), model).toMatchObject({
        vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 65536,
      });
    }
    expect(getCapabilitiesForModel(CN, "sensenova-6.8-flash-lite")).toMatchObject({ contextWindow: 1000000, maxOutput: 131072 });
  });
});

describe("SenseNova `reasoning` field", () => {
  const reasoningDelta = { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", reasoning: "think" } }] };
  const answerDelta = { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] };

  for (const provider of [CN, INTL]) {
    it(`${provider}: passthrough stream lifts delta.reasoning into reasoning_content`, async () => {
      const out = dataEvents(await drain(sseStream([reasoningDelta, answerDelta]).pipeThrough(
        createPassthroughStreamWithLogger(provider, null, "sensenova-6.8-flash", null, null, null, null),
      )));
      expect(out[0].choices[0].delta.reasoning_content).toBe("think");
      expect(out[0].choices[0].delta.reasoning).toBe("think");
      expect(out.at(-1).choices[0].delta.content).toBe("hi");
    });
  }

  it("non-streaming OpenAI→Claude keeps message.reasoning as a thinking block", () => {
    const msg = openAICompletionToClaudeMessage({
      id: "c1",
      model: "sensenova-6.8-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "hi", reasoning: "think" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(msg.content[0]).toEqual({ type: CLAUDE_BLOCK.THINKING, thinking: "think" });
    expect(msg.content[1]).toEqual({ type: CLAUDE_BLOCK.TEXT, text: "hi" });
  });
});
