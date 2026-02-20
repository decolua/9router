import {
  getApiKeyByValue,
  incrementApiKeyRequestUsage,
  incrementApiKeyTokenUsage,
  getApiKeyById,
} from "@/lib/localDb";

function parseBearerApiKey(request) {
  const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeAllowedModels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || "").trim()).filter(Boolean))];
}

function modelMatchesAllowed(model, allowedModel) {
  const requestModel = String(model || "").trim();
  const allow = String(allowedModel || "").trim();
  if (!requestModel || !allow) return false;

  if (requestModel === allow) return true;
  if (requestModel.startsWith(`${allow}/`)) return true;
  if (allow.startsWith(`${requestModel}/`)) return true;

  const requestTail = requestModel.includes("/") ? requestModel.split("/").slice(1).join("/") : requestModel;
  const allowTail = allow.includes("/") ? allow.split("/").slice(1).join("/") : allow;

  if (requestTail && allowTail && requestTail === allowTail) return true;

  return false;
}

export function isModelAllowed(model, allowedModels) {
  if (!model) return true;
  if (!allowedModels || allowedModels.length === 0) return true;
  return allowedModels.some((allowed) => modelMatchesAllowed(model, allowed));
}

function buildQuotaExceededResponse(message, quota = {}) {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "insufficient_quota",
        code: "quota_exceeded",
        quota,
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export async function enforceApiKeyQuota(request, options = {}) {
  const { consumeRequest = true, model = null } = options;
  const rawKey = parseBearerApiKey(request);
  if (!rawKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: {
            message: "Missing API key",
            type: "invalid_request_error",
            code: "missing_api_key",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      ),
    };
  }

  const apiKey = await getApiKeyByValue(rawKey);
  if (!apiKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: {
            message: "Invalid API key",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      ),
    };
  }

  if (apiKey.isActive === false) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: {
            message: "API key is disabled",
            type: "invalid_request_error",
            code: "api_key_disabled",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      ),
    };
  }

  const requestLimit = toNumber(apiKey.requestLimit);
  const tokenLimit = toNumber(apiKey.tokenLimit);
  const requestUsed = toNumber(apiKey.requestUsed);
  const tokenUsed = toNumber(apiKey.tokenUsed);
  const allowedModels = normalizeAllowedModels(apiKey.allowedModels);

  if (!isModelAllowed(model, allowedModels)) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: {
            message: `Model '${model}' is not allowed for this API key`,
            type: "insufficient_permissions",
            code: "model_not_allowed",
            allowedModels,
          },
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      ),
    };
  }

  if (requestLimit > 0 && requestUsed >= requestLimit) {
    return {
      ok: false,
      response: buildQuotaExceededResponse("API key request quota exceeded", {
        requestLimit,
        requestUsed,
        requestRemaining: 0,
        tokenLimit,
        tokenUsed,
        tokenRemaining: tokenLimit > 0 ? Math.max(0, tokenLimit - tokenUsed) : null,
      }),
    };
  }

  if (tokenLimit > 0 && tokenUsed >= tokenLimit) {
    return {
      ok: false,
      response: buildQuotaExceededResponse("API key token quota exceeded", {
        requestLimit,
        requestUsed,
        requestRemaining: requestLimit > 0 ? Math.max(0, requestLimit - requestUsed) : null,
        tokenLimit,
        tokenUsed,
        tokenRemaining: 0,
      }),
    };
  }

  if (consumeRequest) {
    await incrementApiKeyRequestUsage(apiKey.id, 1);
  }

  const updated = await getApiKeyById(apiKey.id);
  return {
    ok: true,
    apiKeyId: apiKey.id,
    apiKey: updated || apiKey,
  };
}

export async function recordApiKeyTokenUsage(apiKeyId, tokens = {}) {
  if (!apiKeyId) return;
  const prompt = toNumber(tokens.prompt_tokens || tokens.input_tokens || tokens.input);
  const completion = toNumber(tokens.completion_tokens || tokens.output_tokens || tokens.output);
  const total = prompt + completion;
  if (total <= 0) return;
  await incrementApiKeyTokenUsage(apiKeyId, total);
}
