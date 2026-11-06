// Gemini Web image adapter — delegates to the executor's DOM-driven image
// generation (type the prompt, wait for the rendered image, download in-page).
import { nowSec } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

export default {
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("gemini-web");
    if (!executor) throw new Error("Gemini Web executor not found");

    const media = await executor.generateMedia({
      prompt: body.prompt,
      size: body.size,
      n: Math.max(1, Math.min(4, Number(body.n) || 1)),
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
