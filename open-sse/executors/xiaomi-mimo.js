import { DefaultExecutor } from "./default.js";
import { getMimoAccountCookie, invalidateMimoAccountCookieCache, resolveMimoServerBase, MIMO_API_UA } from "../shared/mimoAccount.js";

// Dual-route v2.6 models.
// v2.6 models dynamically route to the account service when desktop session credentials
// (mimoPassToken or account cookie) are present to consume weekly quota, falling back to
// the cloud API (sk- key) otherwise.
const ACCOUNT_MODELS = new Set([
  "mimo-v2.6-pro",
  "mimo-v2.6-flash",
  "mimo-v2.6-pro-ultraspeed",
]);

// Session cookie resolved in execute() (async) and read back by buildHeaders()
// (sync — BaseExecutor.execute does not await it). Carried on the per-request
// credentials object, same as runtimeTransport.
const COOKIE_KEY = "__mimoAccountCookie";

// Upstream calls may hand us either the bare id or a `provider/model` ref.
function bareModel(model) {
  const s = String(model || "");
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

export class XiaomiMimoExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-mimo");
  }

  static isAccountRoute(model, credentials) {
    const bare = bareModel(model);
    if (!ACCOUNT_MODELS.has(bare)) return false;
    return Boolean(
      credentials?.[COOKIE_KEY] ||
      credentials?.providerSpecificData?.mimoPassToken
    );
  }

  isAccountRoute(model, credentials) {
    return XiaomiMimoExecutor.isAccountRoute(model, credentials);
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Account route models live on the account-service route, which is not one of the
    // declared transports — resolve it before the default runtimeTransport path.
    if (this.isAccountRoute(model, credentials)) {
      return `${resolveMimoServerBase(credentials?.providerSpecificData)}/api/route/chat/completions`;
    }
    // Cloud API models keep default handling, so a Claude-format client reaches
    // the /anthropic/v1/messages transport.
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  buildHeaders(credentials, stream = true, url, model) {
    if (this.isAccountRoute(model, credentials) && credentials?.[COOKIE_KEY]) {
      // Account route models authenticate with the account-session cookie, not the key.
      return {
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        "User-Agent": MIMO_API_UA,
        Cookie: credentials[COOKIE_KEY],
      };
    }
    return super.buildHeaders(credentials, stream, url, model);
  }

  transformRequest(model, body, stream, credentials) {
    // super runs stripUnsupportedParams, which flattens content-part
    // arrays (see the xiaomi-mimo rule in translator/concerns/paramSupport.js).
    const out = super.transformRequest(model, body, stream, credentials);

    // Account route models: bridge reasoning_effort to official output_config.effort
    // (matches MiMo Desktop app.asar behavior).
    if (this.isAccountRoute(model, credentials)) {
      const rawEffort = out.reasoning_effort || body?.reasoning_effort || body?.output_config?.effort;
      if (rawEffort) {
        delete out.reasoning_effort;
        const norm = String(rawEffort).toLowerCase() === "xhigh" ? "high" : String(rawEffort).toLowerCase();
        out.output_config = { ...(out.output_config || {}), effort: norm };
      }

      if (out.temperature == null) out.temperature = 1.0;
      if (out.top_p == null) out.top_p = 0.95;
    }

    return out;
  }

  async execute(args) {
    const { model, credentials, proxyOptions = null } = args;
    if (!this.isAccountRoute(model, credentials)) return super.execute(args);

    const cookie = await getMimoAccountCookie(credentials?.providerSpecificData, proxyOptions);
    if (!cookie) {
      return super.execute(args);
    }
    credentials[COOKIE_KEY] = cookie;
    const result = await super.execute(args);

    // A cached session can expire early — drop it and retry once with a fresh one.
    if (result.response.status === 401) {
      invalidateMimoAccountCookieCache();
      const fresh = await getMimoAccountCookie(credentials?.providerSpecificData, proxyOptions).catch(() => null);
      if (fresh) {
        credentials[COOKIE_KEY] = fresh;
        return super.execute(args);
      }
    }
    return result;
  }
}

export const __test__ = { ACCOUNT_MODELS, bareModel, COOKIE_KEY };

export default XiaomiMimoExecutor;
