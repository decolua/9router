import assert from "node:assert/strict";
import provider from "../../open-sse/providers/registry/opencode-go.js";

const model = provider.models.find(({ id }) => id === "deepseek-flash");
assert.ok(model, "DeepSeek V4.1 Flash phải có trong OpenCode Go");
assert.equal(model.name, "DeepSeek V4.1 Flash");
assert.deepEqual(model.supportedFormats, ["openai"]);
assert.equal(provider.models.filter(({ id }) => id === "deepseek-flash").length, 1);
assert.ok(provider.models.some(({ id }) => id === "deepseek-v4-flash"));
assert.equal(provider.transports.find(({ format }) => format === model.supportedFormats[0]).baseUrl,
  "https://opencode.ai/zen/go/v1/chat/completions");
