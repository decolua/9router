import { DefaultExecutor } from "./default.js";
import { FORMATS } from "../translator/formats.js";
import { KIMI_PLATFORM_ENDPOINTS, isKimiPlatformApiKey } from "../services/kimi.js";

export class KimiExecutor extends DefaultExecutor {
  constructor() {
    super("kimi");
  }

  withPlatformTransport(credentials) {
    if (credentials?.authType !== "apikey" || !isKimiPlatformApiKey(credentials.apiKey)) return credentials;
    const transport = credentials.runtimeTransport || this.config;
    const baseUrl = KIMI_PLATFORM_ENDPOINTS[transport.format || FORMATS.CLAUDE];
    if (!baseUrl) return credentials;
    return {
      ...credentials,
      runtimeTransport: { ...transport, baseUrl, urlSuffix: undefined, auth: { ...transport.auth, hooks: [] } },
    };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return super.buildUrl(model, stream, urlIndex, this.withPlatformTransport(credentials));
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    return super.buildHeaders(this.withPlatformTransport(credentials), stream, url, model, body);
  }
}

export default KimiExecutor;
