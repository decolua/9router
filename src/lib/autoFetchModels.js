/**
 * Auto-fetch models for a provider connection
 * 
 * This helper function fetches available models from a provider's API
 * and stores them in the connection's providerSpecificData.models field.
 * 
 * @param {string} connectionId - The ID of the provider connection
 * @returns {Promise<{success: boolean, models?: Array, error?: string}>}
 */
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { KiroService } from "@/lib/oauth/services/kiro";
import { GEMINI_CONFIG } from "@/lib/oauth/constants/oauth";
import { refreshGoogleToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";


const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

const parseGeminiCliModels = (data) => {
  if (Array.isArray(data?.models)) {
    return data.models
      .map((item) => {
        const id = item?.id || item?.model || item?.name;
        if (!id) return null;
        return { id, name: item?.displayName || item?.name || id };
      })
      .filter(Boolean);
  }

  if (data?.models && typeof data.models === "object") {
    return Object.entries(data.models)
      .filter(([, info]) => !info?.isInternal)
      .map(([id, info]) => ({
        id,
        name: info?.displayName || info?.name || id,
      }));
  }

  return [];
};


const createOpenAIModelsConfig = (url) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseOpenAIStyleModels
});

const resolveQwenModelsUrl = (connection) => {
  const fallback = "https://portal.qwen.ai/v1/models";
  const raw = connection?.providerSpecificData?.resourceUrl;
  if (!raw || typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return `${value.replace(/\/$/, "")}/models`;
  }
  return `https://${value.replace(/\/$/, "")}/v1/models`;
};


const PROVIDER_MODELS_CONFIG = {
  claude: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data) => data.data || []
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authQuery: "key",
    parseResponse: (data) => data.models || []
  },
  qwen: {
    url: "https://portal.qwen.ai/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  antigravity: {
    url: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    body: {},
    parseResponse: (data) => data.models || []
  },
  github: {
    url: "https://api.githubcopilot.com/models",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "editor-version": "vscode/1.107.1",
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7"
    },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => {
      if (!data?.data) return [];
      return data.data
        .filter(m => m.capabilities?.type === "chat")
        .filter(m => m.policy?.state !== "disabled")
        .map(m => ({
          id: m.id,
          name: m.name || m.id,
          version: m.version,
          capabilities: m.capabilities,
          isDefault: m.model_picker_enabled === true
        }));
    }
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  openrouter: createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json"
    },
    authHeader: "x-api-key",
    parseResponse: (data) => data.data || []
  },
  alicode: {
    url: "https://coding.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data) => data.data || []
  },
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: createOpenAIModelsConfig("https://api.mistral.ai/v1/models"),
  perplexity: createOpenAIModelsConfig("https://api.perplexity.ai/models"),
  together: createOpenAIModelsConfig("https://api.together.xyz/v1/models"),
  fireworks: createOpenAIModelsConfig("https://api.fireworks.ai/inference/v1/models"),
  cerebras: createOpenAIModelsConfig("https://api.cerebras.ai/v1/models"),
  cohere: createOpenAIModelsConfig("https://api.cohere.ai/v1/models"),
  nebius: createOpenAIModelsConfig("https://api.studio.nebius.ai/v1/models"),
  siliconflow: createOpenAIModelsConfig("https://api.siliconflow.cn/v1/models"),
  hyperbolic: createOpenAIModelsConfig("https://api.hyperbolic.xyz/v1/models"),
  nanobanana: createOpenAIModelsConfig("https://api.nanobananaapi.ai/v1/models"),
  chutes: createOpenAIModelsConfig("https://llm.chutes.ai/v1/models"),
  nvidia: createOpenAIModelsConfig("https://integrate.api.nvidia.com/v1/models"),
  assemblyai: createOpenAIModelsConfig("https://api.assemblyai.com/v1/models"),
  ramclouds: createOpenAIModelsConfig("https://ramclouds.me/v1/models")
};

/**
 * Fetch models from provider API and store in connection metadata
 * 
 * @param {string} connectionId - The ID of the provider connection
 * @returns {Promise<{success: boolean, models?: Array, error?: string}>}
 */
export async function autoFetchModels(connectionId) {
  try {
    const connection = await getProviderConnectionById(connectionId);

    if (!connection) {
      console.log(`[autoFetchModels] Connection ${connectionId} not found`);
      return { success: false, error: "Connection not found" };
    }

    let models = [];

    if (isOpenAICompatibleProvider(connection.provider)) {
      const baseUrl = connection.providerSpecificData?.baseUrl;
      if (!baseUrl) {
        console.log(`[autoFetchModels] No base URL for OpenAI compatible provider ${connection.provider}`);
        return { success: false, error: "No base URL configured" };
      }
      
      const url = `${baseUrl.replace(/\/$/, "")}/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${connection.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[autoFetchModels] Failed to fetch models from ${connection.provider}:`, errorText);
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      models = data.data || data.models || [];
    }
    else if (isAnthropicCompatibleProvider(connection.provider)) {
      let baseUrl = connection.providerSpecificData?.baseUrl;
      if (!baseUrl) {
        console.log(`[autoFetchModels] No base URL for Anthropic compatible provider ${connection.provider}`);
        return { success: false, error: "No base URL configured" };
      }

      baseUrl = baseUrl.replace(/\/$/, "");
      if (baseUrl.endsWith("/messages")) {
        baseUrl = baseUrl.slice(0, -9);
      }

      const url = `${baseUrl}/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": connection.apiKey,
          "anthropic-version": "2023-06-01",
          "Authorization": `Bearer ${connection.apiKey}`
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[autoFetchModels] Failed to fetch models from ${connection.provider}:`, errorText);
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      models = data.data || data.models || [];
    }
    else if (connection.provider === "kiro") {
      try {
        const kiroService = new KiroService();
        const profileArn = connection.providerSpecificData?.profileArn;
        const accessToken = connection.accessToken;

        if (accessToken && profileArn) {
          models = await kiroService.listAvailableModels(accessToken, profileArn);
        } else {
          console.log(`[autoFetchModels] Missing Kiro credentials`);
          return { success: false, error: "Missing Kiro credentials" };
        }
      } catch (error) {
        console.log(`[autoFetchModels] Failed to fetch Kiro models:`, error.message);
        return { success: false, error: error.message };
      }
    }
    else if (connection.provider === "gemini-cli") {
      const { accessToken, refreshToken } = connection;
      if (!accessToken) {
        console.log(`[autoFetchModels] No valid token for Gemini CLI`);
        return { success: false, error: "No valid token found" };
      }

      const projectId = connection.projectId || connection.providerSpecificData?.projectId;
      const body = projectId ? { project: projectId } : {};

      const fetchModels = async (token) => {
        const response = await fetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1"
          },
          body: JSON.stringify(body)
        });
        return response;
      };

      try {
        let response = await fetchModels(accessToken);

        if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
          const refreshed = await refreshGoogleToken(refreshToken, GEMINI_CONFIG.clientId, GEMINI_CONFIG.clientSecret);
          if (refreshed?.accessToken) {
            await updateProviderCredentials(connection.id, {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresIn: refreshed.expiresIn,
            });
            response = await fetchModels(refreshed.accessToken);
          }
        }

        if (response.ok) {
          const data = await response.json();
          models = parseGeminiCliModels(data);
        } else {
          const errorText = await response.text();
          console.log(`[autoFetchModels] Failed to fetch Gemini CLI models:`, errorText);
          return { success: false, error: `HTTP ${response.status}` };
        }
      } catch (error) {
        console.log(`[autoFetchModels] Failed to fetch Gemini CLI models:`, error.message);
        return { success: false, error: error.message };
      }
    }
    else {
      const config = PROVIDER_MODELS_CONFIG[connection.provider];
      if (!config) {
        console.log(`[autoFetchModels] Provider ${connection.provider} does not support models listing`);
        return { success: false, error: "Provider does not support models listing" };
      }

      const token = connection.providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey;
      if (!token) {
        console.log(`[autoFetchModels] No valid token for ${connection.provider}`);
        return { success: false, error: "No valid token found" };
      }

      let url = config.url;
      if (connection.provider === "qwen") {
        url = resolveQwenModelsUrl(connection);
      }
      if (config.authQuery) {
        url += `?${config.authQuery}=${token}`;
      }

      const headers = { ...config.headers };
      if (config.authHeader && !config.authQuery) {
        headers[config.authHeader] = (config.authPrefix || "") + token;
      }

      const fetchOptions = {
        method: config.method,
        headers
      };

      if (config.body && config.method === "POST") {
        fetchOptions.body = JSON.stringify(config.body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[autoFetchModels] Failed to fetch models from ${connection.provider}:`, errorText);
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      models = config.parseResponse(data);
    }

    await updateProviderConnection(connectionId, {
      providerSpecificData: {
        ...connection.providerSpecificData,
        models
      }
    });

    console.log(`[autoFetchModels] Successfully fetched ${models.length} models for ${connection.provider}`);
    return { success: true, models };

  } catch (error) {
    console.error(`[autoFetchModels] Error fetching models:`, error);
    return { success: false, error: error.message };
  }
}