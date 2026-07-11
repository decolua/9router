import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const providers = [
  ["minimax", "https://api.minimax.io/v1/text/chatcompletion_v2"],
  ["minimax-cn", "https://api.minimaxi.com/v1/text/chatcompletion_v2"],
];

const request = {
  model: "MiniMax-M3",
  messages: [{ role: "user", content: "Call test." }],
  tools: [
    {
      type: "function",
      function: {
        name: "test",
        description: "Test tool",
        parameters: { type: "object", properties: {} },
      },
    },
  ],
};

describe("MiniMax-M3 tool routing", () => {
  it.each(providers)("routes %s M3 through the standard OpenAI-format endpoint", (provider, baseUrl) => {
    const modelTargetFormat = getModelTargetFormat(provider, "MiniMax-M3");
    const transport = resolveTransport(provider, FORMATS.CLAUDE, modelTargetFormat);

    expect(modelTargetFormat).toBe(FORMATS.OPENAI);
    expect(transport).toMatchObject({
      format: FORMATS.OPENAI,
      baseUrl,
      auth: { header: "Authorization", scheme: "bearer" },
    });
  });

  it.each(providers)("preserves function tool type for %s M3", (provider) => {
    const modelTargetFormat = getModelTargetFormat(provider, "MiniMax-M3");
    const translated = translateRequest(
      FORMATS.OPENAI,
      modelTargetFormat,
      "MiniMax-M3",
      request,
      false,
      null,
      provider,
    );

    expect(translated.tools).toEqual(request.tools);
    expect(translated.tools[0].type).toBe("function");
  });

  it.each(providers)("keeps %s M2.7 on its existing format-aware transports", (provider) => {
    expect(getModelTargetFormat(provider, "MiniMax-M2.7")).toBeNull();
    expect(resolveTransport(provider, FORMATS.CLAUDE)?.format).toBe(FORMATS.CLAUDE);
    expect(resolveTransport(provider, FORMATS.OPENAI)?.format).toBe(FORMATS.OPENAI);
    expect(PROVIDERS[provider].format).toBe(FORMATS.CLAUDE);
  });
});
