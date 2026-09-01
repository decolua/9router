import { GithubExecutor } from "./github.js";

function cleanRoot(value) {
  return String(value || "")
    .replace(/\/v1\/messages\/?$/, "")
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/responses\/?$/, "")
    .replace(/\/+$/, "");
}

function stripProviderPrefix(model) {
  const value = String(model || "");
  return value.startsWith("ghe-copilot/")
    ? value.slice("ghe-copilot/".length)
    : value;
}

export class GheCopilotExecutor extends GithubExecutor {
  constructor() {
    super();
    this.provider = "ghe-copilot";
  }

  resolveApiRoot(credentials) {
    const psd = credentials?.providerSpecificData || {};
    const dynamic =
      psd.copilotApiUrl ||
      psd.copilotProxyUrl ||
      psd.gheUrl;

    if (!dynamic) {
      throw new Error(
        "GHE Copilot requires providerSpecificData.gheUrl or copilotApiUrl"
      );
    }
    return cleanRoot(dynamic);
  }

  async execute(options) {
    const bareModel = stripProviderPrefix(options.model);
    const root = this.resolveApiRoot(options.credentials);

    // Reuse the proven native GitHub Copilot executor, but bind this request
    // to the per-connection GHE Copilot endpoint.
    const delegate = new GithubExecutor();
    delegate.provider = "ghe-copilot";
    delegate.config = {
      ...delegate.config,
      baseUrl: `${root}/chat/completions`,
      responsesUrl: `${root}/responses`,
      messagesUrl: `${root}/v1/messages`,
    };
    delegate.knownCodexModels = this.knownCodexModels;

    const result = await delegate.execute({
      ...options,
      model: bareModel,
    });

    this.knownCodexModels = delegate.knownCodexModels;
    return result;
  }

  async refreshCopilotToken(githubAccessToken, log, _proxyOptions = null, credentials = null) {
    const gheUrl = credentials?.providerSpecificData?.gheUrl;
    if (!gheUrl || !githubAccessToken) return null;

    try {
      const url = `${cleanRoot(gheUrl)}/api/v3/copilot_internal/v2/token`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) return null;

      const data = await response.json();
      return {
        token: data.token,
        expiresAt: data.expires_at,
        endpoints: data.endpoints || null,
      };
    } catch (error) {
      log?.error?.("TOKEN", `GHE Copilot refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshGitHubToken(refreshToken, log, _proxyOptions = null, credentials = null) {
    const gheUrl = credentials?.providerSpecificData?.gheUrl;
    if (!gheUrl || !refreshToken) return null;

    try {
      const psd = credentials?.providerSpecificData || {};
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: psd.clientId || process.env.GITHUB_OAUTH_CLIENT_ID || "",
      });

      if (psd.clientSecret) body.set("client_secret", psd.clientSecret);

      const response = await fetch(`${cleanRoot(gheUrl)}/login/oauth/access_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      });
      if (!response.ok) return null;

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      log?.error?.("TOKEN", `GHE OAuth refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    let active = credentials;
    let copilot = await this.refreshCopilotToken(
      active?.accessToken,
      log,
      proxyOptions,
      active
    );

    if (!copilot && active?.refreshToken) {
      const oauth = await this.refreshGitHubToken(
        active.refreshToken,
        log,
        proxyOptions,
        active
      );
      if (oauth?.accessToken) {
        active = { ...active, ...oauth };
        copilot = await this.refreshCopilotToken(
          active.accessToken,
          log,
          proxyOptions,
          active
        );
      }
    }

    if (!copilot) return active === credentials ? null : active;

    return {
      ...active,
      copilotToken: copilot.token,
      copilotTokenExpiresAt: copilot.expiresAt,
      providerSpecificData: {
        ...(active.providerSpecificData || {}),
        ...(copilot.endpoints?.api
          ? { copilotApiUrl: copilot.endpoints.api }
          : {}),
        ...(copilot.endpoints?.proxy
          ? { copilotProxyUrl: copilot.endpoints.proxy }
          : {}),
      },
    };
  }
}

export default GheCopilotExecutor;
