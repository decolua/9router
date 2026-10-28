// Grok Web image adapter — delegates to the executor, which drives the
// Cloudflare-gated conversations/new endpoint through the wreq-js TLS client
// and downloads the finished asset from assets.grok.com as base64.
import { nowSec } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

export default {
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),
  normalize: (responseBody) => responseBody,

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("grok-web");
    if (!executor) throw new Error("Grok Web executor not found");

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
};
