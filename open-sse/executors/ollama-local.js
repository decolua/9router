import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      // Preserve path + query + urlSuffix (parent contract), substitute the local host.
      // try/catch: malformed/relative/empty baseUrl falls back to verbatim like the parent
      // (default.js:122 uses rt.baseUrl as-is, never parses). WR-01/02/03.
      let url = rt.baseUrl;
      try {
        const u = new URL(rt.baseUrl);
        const host = resolveOllamaLocalHost(credentials).replace(/\/$/, "");
        url = host + u.pathname + u.search;
      } catch {
        url = rt.baseUrl;
      }
      if (rt.urlSuffix) url += rt.urlSuffix;
      return url;
    }
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }
}

export default OllamaLocalExecutor;
