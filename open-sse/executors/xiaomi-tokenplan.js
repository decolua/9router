import { DefaultExecutor } from "./default.js";
import { resolveXiaomiTokenplanBaseUrl } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { FORMATS } from "../translator/formats.js";

export class XiaomiTokenplanExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-tokenplan");
  }

  // Claude-native aliases route to the Anthropic-compatible messages endpoint.
  // getModelTargetFormat keys its lookup by provider id, not model id — passing
  // the model as the first arg returns null and silently downgrades the Claude
  // route to /chat/completions, which 400s with "`function` is not set".
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrl = resolveXiaomiTokenplanBaseUrl(credentials);
    if (getModelTargetFormat(this.provider, model) === FORMATS.CLAUDE) {
      return `${baseUrl.replace(/\/v1\/?$/, "/anthropic/v1")}/messages`;
    }
    return `${baseUrl}/chat/completions`;
  }
}
