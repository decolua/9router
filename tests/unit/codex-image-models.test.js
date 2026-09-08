import { afterEach, describe, expect, it, vi } from "vitest";
import { getModelsByProviderId, getModelType, isValidModel } from "../../open-sse/config/providerModels.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const models = ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"];

afterEach(() => vi.unstubAllGlobals());

describe("Codex GPT-5.6 image models", () => {
  it.each(models)("exposes %s-image as an image model while retaining its chat entry", (model) => {
    const catalog = getModelsByProviderId("codex");
    expect(catalog.filter((entry) => entry.id === `${model}-image`)).toHaveLength(1);
    expect(catalog.find((entry) => entry.id === `${model}-image`)).toMatchObject({
      kind: "image",
      capabilities: ["text2img", "edit"],
      params: ["size", "quality", "background", "image_detail", "output_format"],
    });
    expect(isValidModel("cx", `${model}-image`)).toBe(true);
    expect(getModelType("cx", `${model}-image`)).toBe("image");
    expect(catalog.find((entry) => entry.id === model)).toBeDefined();
    expect(getModelType("cx", model)).not.toBe("image");
  });

  it.each(models)("routes %s-image edits and streams image events", async (model) => {
    const events = [
      ["response.image_generation_call.partial_image", { partial_image_b64: "cGFydGlhbA==", partial_image_index: 0 }],
      ["response.output_item.done", { item: { type: "image_generation_call", result: "ZmluYWw=" } }],
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const onRequestSuccess = vi.fn();
    const modelInfo = await getModelInfoCore(`cx/${model}-image`);
    expect(modelInfo).toEqual({ provider: "codex", model: `${model}-image` });
    expect(await getModelInfoCore(`codex/${model}-image`)).toEqual(modelInfo);

    const result = await handleImageGenerationCore({
      modelInfo,
      body: {
        prompt: "Make the square blue",
        image: "data:image/png;base64,cmVmZXJlbmNl",
        image_detail: "low",
        size: "1024x1024",
        quality: "high",
        background: "transparent",
        output_format: "WEBP",
      },
      credentials: { accessToken: "test-token" },
      streamToClient: true,
      onRequestSuccess,
    });

    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const upstreamBody = JSON.parse(options.body);
    expect(upstreamBody.model).toBe(model);
    expect(upstreamBody.tools).toEqual([{
      type: "image_generation", output_format: "webp", size: "1024x1024",
      quality: "high", background: "transparent",
    }]);
    expect(upstreamBody.input[0].content).toContainEqual({
      type: "input_image", image_url: "data:image/png;base64,cmVmZXJlbmNl", detail: "low",
    });
    const stream = await result.response.text();
    expect(stream).toContain('event: partial_image\ndata: {"b64_json":"cGFydGlhbA==","index":0}');
    expect(stream).toContain("event: done\n");
    expect(stream).toContain('"data":[{"b64_json":"ZmluYWw="}]');
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });
});
