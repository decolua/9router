// ChatGPT Web image adapter — delegates to the executor's picture_v2 in-page
// generation flow (prepare → conversation SSE → poll → download).
import { nowSec } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

export default {
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("chatgpt-web");
    if (!executor) throw new Error("ChatGPT Web executor not found");

    const media = await executor.generateMedia({
      prompt: body.prompt,
      n: Math.max(1, Math.min(4, Number(body.n) || 1)),
      size: body.size,
      credentials,
      log,
    });

    return {
      created: nowSec(),
      data: media.map((m) => ({
        b64_json: m.b64,
        ...(m.mime ? { mime_type: m.mime } : {}),
      })),
    };
  },

  normalize: (responseBody) => responseBody,
};
