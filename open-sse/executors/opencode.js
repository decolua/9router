import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { FORMATS } from "../translator/formats.js";

function getOpenCodePath(model) {
  const targetFormat = getModelTargetFormat("oc", model);

  if (targetFormat === FORMATS.OPENAI_RESPONSES) return "/zen/v1/responses";
  if (targetFormat === FORMATS.CLAUDE) return "/zen/v1/messages";
  if (targetFormat === FORMATS.GEMINI) return `/zen/v1/models/${model}`;
  return "/zen/v1/chat/completions";
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  buildUrl(model) {
    const base = "https://opencode.ai";
    return `${base}${getOpenCodePath(model)}`;
  }

  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "x-opencode-client": "desktop",
      "Accept": "text/event-stream"
    };
  }
}
