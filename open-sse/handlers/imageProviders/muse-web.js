// Muse Web (muse.ai Hatch) image adapter — delegates to the executor, which
// drives the Hatch agent in a real browser page and downloads the generated
// attachment in-page as base64.
import { nowSec } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

export default {
  // Delegate to executor instead of building URL/headers/body manually
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("muse-web");
    if (!executor) throw new Error("Muse Web executor not found");

    const media = await executor.generateMedia({
      prompt: body.prompt,
      kind: "image",
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
