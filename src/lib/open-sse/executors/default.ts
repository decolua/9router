import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants";
import { buildClineHeaders } from "@/shared/utils/clineAuth";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache";

export class DefaultExecutor extends BaseExecutor {
  constructor(provider: string) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials: any = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.anthropic.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    switch (this.provider) {
      case "claude":
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
        return `${this.config.baseUrl}?beta=true`;
      case "kimi-coding":
        return `${this.config.baseUrl}?beta=true`;
      case "gemini":
        return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      default:
        return this.config.baseUrl;
    }
  }

  buildHeaders(credentials: any, stream = true) {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...this.config.headers };

    switch (this.provider) {
      case "gemini":
        if (credentials.apiKey) headers["x-goog-api-key"] = credentials.apiKey;
        else headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        break;
      case "claude": {
        const cached = getCachedClaudeHeaders();
        if (cached) {
          for (const lcKey of Object.keys(cached)) {
            const titleKey = lcKey.replace(/(^|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
            if (lcKey === "anthropic-beta") {
              const staticBetaStr = headers[titleKey] || headers[lcKey] || "";
              const staticFlags = new Set(staticBetaStr.split(",").map(f => f.trim()).filter(Boolean));
              const cachedFlags = new Set((cached[lcKey] as string).split(",").map(f => f.trim()).filter(Boolean));
              for (const flag of staticFlags) cachedFlags.add(flag);
              cached[lcKey] = Array.from(cachedFlags).join(",");
            }
            if (titleKey !== lcKey && headers[titleKey] !== undefined) delete headers[titleKey];
          }
          Object.assign(headers, cached);
        }
        if (credentials.apiKey) headers["x-api-key"] = credentials.apiKey;
        else headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        break;
      }
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
        headers["x-api-key"] = credentials.apiKey || credentials.accessToken;
        break;
      case "kimi-coding":
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        Object.assign(headers, buildKimiHeaders());
        break;
      default:
        if (this.provider?.startsWith?.("anthropic-compatible-")) {
          if (credentials.apiKey) headers["x-api-key"] = credentials.apiKey;
          else if (credentials.accessToken) headers["Authorization"] = `Bearer ${credentials.accessToken}`;
          if (!headers["anthropic-version"]) headers["anthropic-version"] = "2023-06-01";
        } else if (this.provider === "gitlab") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        } else if (this.provider === "codebuddy") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        } else if (this.provider === "kilocode") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
          if (credentials.providerSpecificData?.orgId) headers["X-Kilocode-OrganizationID"] = credentials.providerSpecificData.orgId;
        } else if (this.provider === "cline") {
          Object.assign(headers, buildClineHeaders(credentials.apiKey || credentials.accessToken));
        } else {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        }
    }

    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey].split(",").map((s: string) => s.trim()).filter((f: string) => f && f !== "claude-code-20250219").join(",");
            if (filtered) headers[betaKey] = filtered; else delete headers[betaKey];
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async refreshCredentials(credentials: any, log?: any): Promise<any> {
    if (!credentials.refreshToken) return null;

    const refreshers: Record<string, () => Promise<any>> = {
      claude: () => this.refreshWithJSON(OAUTH_ENDPOINTS.anthropic.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.claude.clientId }),
      codex: () => this.refreshWithForm(OAUTH_ENDPOINTS.openai.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.codex.clientId, scope: "openid profile email offline_access" }),
      qwen: () => this.refreshWithForm(OAUTH_ENDPOINTS.qwen.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.qwen.clientId }),
      iflow: () => this.refreshIflow(credentials.refreshToken),
      gemini: () => this.refreshGoogle(credentials.refreshToken),
      kiro: () => this.refreshKiro(credentials.refreshToken),
      cline: () => this.refreshCline(credentials.refreshToken),
      "kimi-coding": () => this.refreshKimiCoding(credentials.refreshToken),
      kilocode: () => this.refreshKilocode(credentials.refreshToken)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error: any) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url: string, body: any) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url: string, params: any) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) query.append(k, String(v));
    }
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: query.toString() });
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshIflow(refreshToken: string) {
    const basicAuth = Buffer.from(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`).toString("base64");
    const query = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS.iflow.clientId || "", client_secret: PROVIDERS.iflow.clientSecret || "" });
    const response = await fetch(OAUTH_ENDPOINTS.iflow.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` }, body: query.toString() });
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshGoogle(refreshToken: string) {
    const query = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.config.clientId, client_secret: this.config.clientSecret });
    const response = await fetch(OAUTH_ENDPOINTS.google.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: query.toString() });
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKiro(refreshToken: string) {
    if (!PROVIDERS.kiro.tokenUrl) return null;
    const response = await fetch(PROVIDERS.kiro.tokenUrl, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" }, body: JSON.stringify({ refreshToken }) });
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || refreshToken, expiresIn: tokens.expiresIn };
  }

  async refreshCline(refreshToken: string) {
    const response = await fetch("https://api.cline.bot/api/v1/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" }) });
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || payload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    return { accessToken: data?.accessToken, refreshToken: data?.refreshToken || refreshToken, expiresIn };
  }

  async refreshKimiCoding(refreshToken: string) {
    const kimiHeaders = buildKimiHeaders();
    const query = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "17e5f671-d194-4dfb-9706-5516cb48c098" });
    const response = await fetch("https://auth.kimi.com/api/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", ...kimiHeaders }, body: query.toString() });
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refreshKilocode(refreshToken: string) {
    return null;
  }
}

export default DefaultExecutor;
