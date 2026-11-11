// UC image adapter — delegates to the executor (persona web path, un-metered:
// Clerk JWT minted from the pasted __client cookie).
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
    const executor = getExecutor("uc-web");
    if (!executor) throw new Error("uc-web executor not found");

    const media = await executor.generateMedia({
      prompt: body.prompt,
      kind: "image",
      size: body.size,
      model,
      resolution: body.resolution,
      credentials,
      log,
    });

    return {
      created: nowSec(),
      data: media.map((m) => ({ b64_json: m.b64, ...(m.mime ? { mime_type: m.mime } : {}) })),
    };
  },
};
