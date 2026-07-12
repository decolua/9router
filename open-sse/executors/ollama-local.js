import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }

  transformRequest(model, body, stream) {
    return {
      ...body,
      model,
      stream
    };
  }
}

export default OllamaLocalExecutor;
