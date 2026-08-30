import { describe, expect, it } from "vitest";

import { buildPlaygroundRequest } from "../../src/app/(dashboard)/dashboard/playground/lib/requestBuilder.js";

const model = {
  id: "test-provider/test-model",
  capabilities: {
    temperature: true,
    topP: true,
    maxTokens: true,
    stop: true,
    seed: false,
    reasoning: false,
    images: false,
  },
};

const sharedInput = {
  model,
  messages: [{ role: "user", content: "Explain why the sky is blue." }],
  systemPrompt: "Answer in two sentences.",
  controls: {
    temperature: 0.2,
    topP: 0.9,
    maxTokens: 256,
    stop: ["END"],
    seed: 7,
    reasoning: { effort: "high" },
  },
};

describe("buildPlaygroundRequest", () => {
  it("builds one capability-aware body for Chat and Compare model columns", () => {
    const chat = buildPlaygroundRequest(sharedInput);
    const compare = buildPlaygroundRequest({
      ...sharedInput,
      model: { ...model, id: "test-provider/second-model" },
    });

    expect(chat).toEqual({
      model: "test-provider/test-model",
      messages: [
        { role: "system", content: "Answer in two sentences." },
        { role: "user", content: "Explain why the sky is blue." },
      ],
      stream: true,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 256,
      stop: ["END"],
    });
    expect({ ...chat, model: compare.model }).toEqual(compare);
    expect(chat).not.toHaveProperty("seed");
    expect(chat).not.toHaveProperty("reasoning_effort");
  });

  it("omits default, invalid, and unsupported controls", () => {
    const body = buildPlaygroundRequest({
      ...sharedInput,
      controls: {
        temperature: 1,
        topP: 1,
        maxTokens: 0,
        presencePenalty: "bad",
        frequencyPenalty: 0,
        seed: 7,
        reasoning: { effort: "high" },
      },
    });

    expect(body).toEqual({
      model: "test-provider/test-model",
      messages: [
        { role: "system", content: "Answer in two sentences." },
        { role: "user", content: "Explain why the sky is blue." },
      ],
      stream: true,
    });
  });

  it("adds images only when the selected model supports them", () => {
    const body = buildPlaygroundRequest({
      ...sharedInput,
      model: { ...model, capabilities: { ...model.capabilities, images: true } },
      images: [{ type: "image/png", size: 3, dataUrl: "data:image/png;base64,AAA" }],
    });

    expect(body.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Explain why the sky is blue." },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    });
  });

  it("rejects more than four images or an image over two MiB without adding it to a request", () => {
    const images = Array.from({ length: 5 }, (_, index) => ({
      type: "image/png",
      size: index + 1,
      dataUrl: "data:image/png;base64,AAA",
    }));
    const supportedModel = { ...model, capabilities: { ...model.capabilities, images: true } };

    expect(() => buildPlaygroundRequest({ ...sharedInput, model: supportedModel, images })).toThrow(/four images/i);
    expect(() => buildPlaygroundRequest({
      ...sharedInput,
      model: supportedModel,
      images: [{ type: "image/png", size: 2 * 1024 * 1024 + 1, dataUrl: "data:image/png;base64,AAA" }],
    })).toThrow(/two MiB/i);
  });

  it("rejects more than four stop sequences or a stop sequence over 256 characters", () => {
    expect(() => buildPlaygroundRequest({
      ...sharedInput,
      controls: { ...sharedInput.controls, stop: ["one", "two", "three", "four", "five"] },
    })).toThrow(/four stop sequences/i);
    expect(() => buildPlaygroundRequest({
      ...sharedInput,
      controls: { ...sharedInput.controls, stop: ["x".repeat(257)] },
    })).toThrow(/256 characters/i);
  });
});
