import { DefaultExecutor } from "./default.js";
import { resolveXiaomiTokenplanBaseUrl } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { FORMATS } from "../translator/formats.js";

export class XiaomiTokenplanExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-tokenplan");
  }

  // Claude-native aliases route to the Anthropic-compatible messages endpoint
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrl = resolveXiaomiTokenplanBaseUrl(credentials);
    if (getModelTargetFormat(model, model) === FORMATS.CLAUDE) {
      return `${baseUrl.replace(/\/v1\/?$/, "/anthropic/v1")}/messages`;
    }
    return `${baseUrl}/chat/completions`;
  }
}
