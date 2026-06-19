import { DefaultExecutor } from "./default.js";
import { resolveXiaomiTokenplanBaseUrl } from "../config/providers.js";
// import { getModelTargetFormat } from "../config/providerModels.js";
// import { FORMATS } from "../translator/formats.js";

export class XiaomiTokenplanExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-tokenplan");
  }

  // Token Plan keys are region-specific — always OpenAI-compatible /chat/completions
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrl = resolveXiaomiTokenplanBaseUrl(credentials);
    // Claude-native aliases route to the Anthropic-compatible messages endpoint
    // if (getModelTargetFormat(this.provider, model) === FORMATS.CLAUDE) {
    //   return `${baseUrl.replace(/\/v1\/?$/, "/anthropic/v1")}/messages`;
    // }
    return `${baseUrl}/chat/completions`;
  }
}
