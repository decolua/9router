import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProviderConnectionById } from "@/lib/localDb";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { GEMINI_CONFIG } from "@/lib/oauth/constants/oauth";
import { refreshGoogleToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveOllamaLocalHost } from "open-sse/config/providers.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";

type JsonObject = Record<string, JsonValue>;
type JsonArray = JsonValue[];

type CustomResolverResult = {
  models?: JsonArray;
  warning?: string;
  error?: string;
  status?: number;
};

type StandardModelConfig = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  authHeader?: string;
  authPrefix?: string;
  authQuery?: string;
  body?: JsonObject;
  parseResponse: (data: JsonValue) => JsonArray;
  customResolver?: undefined;
};

type CustomModelConfig = {
  customResolver: (connection: ProviderConnection) => Promise<CustomResolverResult>;
  url?: undefined;
  method?: undefined;
  headers?: undefined;
  authHeader?: undefined;
  authPrefix?: undefined;
  authQuery?: undefined;
  body?: undefined;
  parseResponse?: undefined;
};

type ModelConfig = StandardModelConfig | CustomModelConfig;

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

const parseOpenAIStyleModels = (data: JsonValue): JsonArray => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as JsonObject;
    if (Array.isArray(obj["data"])) return obj["data"] as JsonArray;
    if (Array.isArray(obj["models"])) return obj["models"] as JsonArray;
    if (Array.isArray(obj["results"])) return obj["results"] as JsonArray;
  }
  return [];
};

const parseGeminiCliModels = (data: JsonValue): JsonArray => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const obj = data as JsonObject;
  if (Array.isArray(obj["models"])) {
    return (obj["models"] as JsonArray).map((m) => {
      if (!m || typeof m !== "object" || Array.isArray(m)) return m ?? null;
      const model = m as JsonObject;
      const entry: JsonObject = {};
      if (model["name"] !== undefined) entry["id"] = model["name"] ?? null;
      if (model["name"] !== undefined) entry["name"] = model["name"] ?? null;
      if (model["description"] !== undefined) entry["description"] = model["description"] ?? null;
      return entry;
    });
  }
  if (obj["models"] && typeof obj["models"] === "object") {
    return Object.keys(obj["models"] as JsonObject).map((key) => ({ id: key, name: key }));
  }
  return [];
};

const appendCodexReviewModels = (models: JsonArray): JsonArray =>
  models.flatMap((model) => {
    if (!model || typeof model !== "object" || Array.isArray(model)) return model ? [model as JsonValue] : [];
    const m = model as JsonObject;
    const id = ((m["id"] ?? m["slug"] ?? m["model"] ?? m["name"]) as string | null | undefined) || null;
    if (!id) return [];
    const name = (m["display_name"] ?? m["displayName"] ?? m["name"] ?? id) as string;
    const normalized: JsonObject = { ...m, id, name };
    const isChatModel = ((m["type"] as string | undefined) || "llm") !== "image" && !id.toLowerCase().includes("embed");
    if (!isChatModel || id.endsWith("-review")) return [normalized];
    return [
      normalized,
      { ...normalized, id: `${id}-review`, name: `${name} Review`, upstreamModelId: id, quotaFamily: "review" },
    ];
  });

const parseCodexModels = (data: JsonValue): JsonArray => appendCodexReviewModels(parseOpenAIStyleModels(data));

function createOpenAIModelsConfig(url: string) {
  const config: StandardModelConfig = {
    url,
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: parseOpenAIStyleModels,
  };
  return config;
}

const resolveQwenModelsUrl = (connection: ProviderConnection) => {
  const fallback = "https://portal.qwen.ai/v1/models";
  const psd = connection.providerSpecificData as JsonObject | undefined;
  const raw = psd?.["resourceUrl"];
  if (!raw || typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("http://") || value.startsWith("https://")) return `${value.replace(/\/$/, "")}/models`;
  return `https://${value.replace(/\/$/, "")}/v1/models`;
};

const buildOAuthResolver = (opts: {
  refreshFn: (conn: ProviderConnection) => Promise<{ accessToken?: string; refreshToken?: string; expiresIn?: number } | null>;
  fetchFn: (token: string, conn: ProviderConnection) => Promise<Response>;
  parseFn: (data: JsonValue) => JsonArray;
  errorLabel: string;
}) => {
  const resolver = async (connection: ProviderConnection) => {
    const conn = connection as ProviderConnection & { accessToken?: string; refreshToken?: string };
    if (!conn.accessToken) {
      const result: CustomResolverResult = { error: "No valid token found", status: 401 };
      return result;
    }
    let warning: string | undefined;
    try {
      let response = await opts.fetchFn(conn.accessToken, connection);
      if (!response.ok && (response.status === 401 || response.status === 403) && conn.refreshToken) {
        const refreshed = await opts.refreshFn(connection);
        if (refreshed?.accessToken) {
          await updateProviderCredentials(connection.id, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken || conn.refreshToken,
            expiresIn: refreshed.expiresIn,
          });
          conn.accessToken = refreshed.accessToken;
          if (refreshed.refreshToken) conn.refreshToken = refreshed.refreshToken;
          response = await opts.fetchFn(refreshed.accessToken, connection);
        }
      }
      if (response.ok) {
        const data = await response.json() as JsonValue;
        const models = opts.parseFn(data);
        if (models.length > 0) {
          const result: CustomResolverResult = { models };
          return result;
        }
      } else {
        const errorText = await response.text();
        warning = `${opts.errorLabel}: ${response.status} ${errorText}`;
        console.log(`${opts.errorLabel} (falling back to static):`, errorText);
      }
    } catch (error) {
      const err = error as Error;
      warning = `${opts.errorLabel}: ${err.message}`;
      console.log(`${opts.errorLabel} (falling back to static):`, err.message);
    }
    const result: CustomResolverResult = { models: [], ...(warning !== undefined ? { warning } : {}) };
    return result;
  };
  return resolver;
};

const pickDataArray = (d: JsonValue) => {
  const obj = d as JsonObject;
  return Array.isArray(obj["data"]) ? obj["data"] as JsonArray : [];
};

const pickModelsArray = (d: JsonValue) => {
  const obj = d as JsonObject;
  return Array.isArray(obj["models"]) ? obj["models"] as JsonArray : [];
};

const PROVIDER_MODELS_CONFIG: Record<string, ModelConfig> = {
  claude: { url: "https://api.anthropic.com/v1/models", method: "GET", headers: { "Anthropic-Version": "2023-06-01", "Content-Type": "application/json" }, authHeader: "x-api-key", parseResponse: pickDataArray },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models", method: "GET", headers: { "Content-Type": "application/json" }, authQuery: "key", parseResponse: pickModelsArray },
  qwen: { url: "https://portal.qwen.ai/v1/models", method: "GET", headers: { "Content-Type": "application/json" }, authHeader: "Authorization", authPrefix: "Bearer ", parseResponse: pickDataArray },
  codex: { url: "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0", method: "GET", headers: { "Content-Type": "application/json", "Accept": "application/json" }, authHeader: "Authorization", authPrefix: "Bearer ", parseResponse: parseCodexModels },
  antigravity: { url: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models", method: "POST", headers: { "Content-Type": "application/json" }, authHeader: "Authorization", authPrefix: "Bearer ", body: {}, parseResponse: pickModelsArray },
  github: {
    url: "https://api.githubcopilot.com/models", method: "GET",
    headers: { "Content-Type": "application/json", "Copilot-Integration-Id": "vscode-chat", "editor-version": "vscode/1.107.1", "editor-plugin-version": "copilot-chat/0.26.7", "user-agent": "GitHubCopilotChat/0.26.7" },
    authHeader: "Authorization", authPrefix: "Bearer ",
    parseResponse: (d) => {
      const obj = d as JsonObject;
      if (!Array.isArray(obj["data"])) return [];
      return (obj["data"] as JsonArray)
        .filter((m) => m && typeof m === "object" && !Array.isArray(m) && (m as JsonObject)["capabilities"] && ((m as JsonObject)["capabilities"] as JsonObject)["type"] === "chat")
        .filter((m) => !((m as JsonObject)["policy"]) || ((m as JsonObject)["policy"] as JsonObject)["state"] !== "disabled")
        .map((m) => {
          const model = m as JsonObject;
          const entry: JsonObject = {
            id: model["id"] ?? null,
            name: model["name"] ?? model["id"] ?? null,
            version: model["version"] ?? null,
            capabilities: model["capabilities"] ?? null,
            isDefault: model["model_picker_enabled"] === true,
          };
          return entry;
        });
    },
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  openrouter: createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
  anthropic: { url: "https://api.anthropic.com/v1/models", method: "GET", headers: { "Anthropic-Version": "2023-06-01", "Content-Type": "application/json" }, authHeader: "x-api-key", parseResponse: pickDataArray },
  alicode: { url: "https://coding.dashscope.aliyuncs.com/v1/models", method: "GET", headers: { "Content-Type": "application/json" }, authHeader: "Authorization", authPrefix: "Bearer ", parseResponse: pickDataArray },
  "alicode-intl": { url: "https://coding-intl.dashscope.aliyuncs.com/v1/models", method: "GET", headers: { "Content-Type": "application/json" }, authHeader: "Authorization", authPrefix: "Bearer ", parseResponse: pickDataArray },
  "volcengine-ark": createOpenAIModelsConfig("https://ark.cn-beijing.volces.com/api/coding/v3/models"),
  byteplus: createOpenAIModelsConfig("https://ark.ap-southeast.bytepluses.com/api/coding/v3/models"),
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: createOpenAIModelsConfig("https://api.mistral.ai/v1/models"),
  perplexity: createOpenAIModelsConfig("https://api.perplexity.ai/v1/models"),
  together: createOpenAIModelsConfig("https://api.together.xyz/v1/models"),
  fireworks: createOpenAIModelsConfig("https://api.fireworks.ai/inference/v1/models"),
  cerebras: createOpenAIModelsConfig("https://api.cerebras.ai/v1/models"),
  cohere: createOpenAIModelsConfig("https://api.cohere.ai/v1/models"),
  nebius: createOpenAIModelsConfig("https://api.studio.nebius.ai/v1/models"),
  siliconflow: createOpenAIModelsConfig("https://api.siliconflow.com/v1/models"),
  hyperbolic: createOpenAIModelsConfig("https://api.hyperbolic.xyz/v1/models"),
  ollama: createOpenAIModelsConfig("https://ollama.com/api/tags"),
  nanobanana: createOpenAIModelsConfig("https://api.nanobananaapi.ai/v1/models"),
  chutes: createOpenAIModelsConfig("https://llm.chutes.ai/v1/models"),
  nvidia: createOpenAIModelsConfig("https://integrate.api.nvidia.com/v1/models"),
  assemblyai: createOpenAIModelsConfig("https://api.assemblyai.com/v1/models"),
  "vercel-ai-gateway": createOpenAIModelsConfig("https://ai-gateway.vercel.sh/v1/models"),
  kiro: {
    customResolver: async (connection) => {
      const conn = connection as ProviderConnection & { accessToken?: string; refreshToken?: string };
      const creds = {
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        providerSpecificData: (connection.providerSpecificData as JsonObject) || {},
      };
      let warning: string | undefined;
      try {
        const result = await resolveKiroModels(creds, {
          log: console,
          onCredentialsRefreshed: async (refreshed: { accessToken?: string; refreshToken?: string; expiresIn?: number }) => {
            if (refreshed?.accessToken) {
              await updateProviderCredentials(connection.id, {
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken || conn.refreshToken,
                expiresIn: refreshed.expiresIn,
              });
              conn.accessToken = refreshed.accessToken;
              if (refreshed.refreshToken) conn.refreshToken = refreshed.refreshToken;
            }
          },
        });
        if (result?.models?.length) {
          const models: JsonArray = (result.models as Array<{
            id: string; name?: string; upstreamModelId?: string;
            contextLength?: number; rateMultiplier?: number;
            capabilities?: JsonValue; description?: string;
          }>).map((m) => {
            const entry: JsonObject = { id: m.id };
            if (m.name !== undefined) entry["name"] = m.name;
            if (m.upstreamModelId !== undefined) entry["upstreamModelId"] = m.upstreamModelId;
            if (m.contextLength !== undefined) entry["contextLength"] = m.contextLength;
            if (m.rateMultiplier !== undefined) entry["rateMultiplier"] = m.rateMultiplier;
            if (m.capabilities !== undefined) entry["capabilities"] = m.capabilities;
            if (m.description !== undefined) entry["description"] = m.description;
            return entry;
          });
          const r: CustomResolverResult = { models };
          return r;
        }
        warning = "Kiro returned no models; falling back to static catalog.";
      } catch (error) {
        const err = error as Error;
        warning = `Failed to fetch Kiro models: ${err.message}`;
        console.log("Failed to fetch Kiro models dynamically, falling back to static:", err.message);
      }
      const r: CustomResolverResult = { models: [], ...(warning !== undefined ? { warning } : {}) };
      return r;
    },
  },
  qoder: {
    customResolver: async (connection) => {
      const conn = connection as ProviderConnection & { accessToken?: string; refreshToken?: string; email?: string; displayName?: string };
      const creds = {
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        email: conn.email,
        displayName: conn.displayName,
        providerSpecificData: (connection.providerSpecificData as JsonObject) || {},
      };
      let warning: string | undefined;
      try {
        const result = await resolveQoderModels(creds, { forceRefresh: true });
        if (result?.models?.length) {
          const models: JsonArray = (result.models as Array<{
            id: string; name?: string; contextLength?: number;
            isVL?: boolean; isReasoning?: boolean; maxOutputTokens?: number; description?: string;
          }>).map((m) => {
            const entry: JsonObject = { id: `qoder/${m.id}` };
            if (m.name !== undefined) entry["name"] = m.name;
            if (m.contextLength !== undefined) entry["contextLength"] = m.contextLength;
            if (m.isVL !== undefined) entry["isVL"] = m.isVL;
            if (m.isReasoning !== undefined) entry["isReasoning"] = m.isReasoning;
            if (m.maxOutputTokens !== undefined) entry["maxOutputTokens"] = m.maxOutputTokens;
            if (m.description !== undefined) entry["description"] = m.description;
            return entry;
          });
          const r: CustomResolverResult = { models };
          return r;
        }
        warning = "Qoder returned no models; falling back to static catalog.";
      } catch (error) {
        const err = error as Error;
        warning = `Failed to fetch Qoder models: ${err.message}`;
        console.log("Failed to fetch Qoder models dynamically, falling back to static:", err.message);
      }
      const r: CustomResolverResult = { models: [], ...(warning !== undefined ? { warning } : {}) };
      return r;
    },
  },
  "gemini-cli": {
    customResolver: buildOAuthResolver({
      refreshFn: (conn) => {
        const c = conn as ProviderConnection & { refreshToken?: string };
        return refreshGoogleToken(c.refreshToken ?? "", GEMINI_CONFIG.clientId, GEMINI_CONFIG.clientSecret);
      },
      fetchFn: (token, conn) => {
        const psd = conn.providerSpecificData as JsonObject | undefined;
        const c = conn as ProviderConnection & { projectId?: string };
        const projectId = c.projectId || (psd?.["projectId"] as string | undefined);
        const body = projectId ? { project: projectId } : {};
        return fetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, "User-Agent": "google-api-nodejs-client/9.15.1", "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1" },
          body: JSON.stringify(body),
        });
      },
      parseFn: parseGeminiCliModels,
      errorLabel: "Failed to fetch Gemini CLI models",
    }),
  },
  "ollama-local": {
    customResolver: async (connection) => {
      const url = `${resolveOllamaLocalHost(connection)}/api/tags`;
      const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
      if (!response.ok) {
        const errorText = await response.text();
        console.log("Error fetching models from ollama-local:", errorText);
        const r: CustomResolverResult = { error: `Failed to fetch models: ${response.status}`, status: response.status };
        return r;
      }
      const data = await response.json() as JsonValue;
      const r: CustomResolverResult = { models: parseOpenAIStyleModels(data) };
      return r;
    },
  },
};

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const conn = connection as ProviderConnection & { apiKey?: string; accessToken?: string };
    const psd = connection.providerSpecificData as JsonObject | undefined;

    if (isOpenAICompatibleProvider(connection.provider)) {
      const baseUrl = psd?.["baseUrl"] as string | undefined;
      if (!baseUrl) return NextResponse.json({ error: "No base URL configured for OpenAI compatible provider" }, { status: 400 });
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { method: "GET", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${conn.apiKey}` } });
      if (!response.ok) {
        console.log(`Error fetching models from ${connection.provider}:`, await response.text());
        return NextResponse.json({ error: `Failed to fetch models: ${response.status}` }, { status: response.status });
      }
      const data = await response.json() as JsonObject;
      return NextResponse.json({ provider: connection.provider, connectionId: connection.id, models: data["data"] || data["models"] || [] });
    }

    if (isAnthropicCompatibleProvider(connection.provider)) {
      const rawBase = psd?.["baseUrl"] as string | undefined;
      if (!rawBase) return NextResponse.json({ error: "No base URL configured for Anthropic compatible provider" }, { status: 400 });
      let baseUrl = rawBase.replace(/\/$/, "");
      if (baseUrl.endsWith("/messages")) baseUrl = baseUrl.slice(0, -9);
      const apiKey = conn.apiKey ?? "";
      const response = await fetch(`${baseUrl}/models`, { method: "GET", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Authorization": `Bearer ${apiKey}` } });
      if (!response.ok) {
        console.log(`Error fetching models from ${connection.provider}:`, await response.text());
        return NextResponse.json({ error: `Failed to fetch models: ${response.status}` }, { status: response.status });
      }
      const data = await response.json() as JsonObject;
      return NextResponse.json({ provider: connection.provider, connectionId: connection.id, models: data["data"] || data["models"] || [] });
    }

    const config = PROVIDER_MODELS_CONFIG[connection.provider];
    if (!config) {
      return NextResponse.json({ error: `Provider ${connection.provider} does not support models listing` }, { status: 400 });
    }

    if (config.customResolver) {
      const result = await config.customResolver(connection);
      if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 500 });
      return NextResponse.json({ provider: connection.provider, connectionId: connection.id, models: result.models, ...(result.warning !== undefined ? { warning: result.warning } : {}) });
    }

    const token = (psd?.["copilotToken"] as string | undefined) || conn.accessToken || conn.apiKey;
    if (!token) return NextResponse.json({ error: "No valid token found" }, { status: 401 });

    let url = config.url;
    if (connection.provider === "qwen") url = resolveQwenModelsUrl(connection);
    if (config.authQuery) url += `?${config.authQuery}=${token}`;

    const headers = { ...config.headers };
    if (config.authHeader && !config.authQuery) headers[config.authHeader] = (config.authPrefix || "") + token;

    const fetchOptions: RequestInit = { method: config.method, headers };
    if (config.body && config.method === "POST") fetchOptions.body = JSON.stringify(config.body);

    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      console.log(`Error fetching models from ${connection.provider}:`, await response.text());
      return NextResponse.json({ error: `Failed to fetch models: ${response.status}` }, { status: response.status });
    }

    const data = await response.json() as JsonValue;
    return NextResponse.json({ provider: connection.provider, connectionId: connection.id, models: config.parseResponse(data) });
  } catch (error) {
    console.log("Error fetching provider models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
