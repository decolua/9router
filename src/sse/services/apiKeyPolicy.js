import { getApiKeyByValue, getSettings, reserveApiKeyTokens, settleApiKeyTokens } from "@/lib/localDb";
import { extractApiKey } from "./auth.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

function tokenEstimate(body) {
  const text = JSON.stringify(body?.messages || body?.input || body?.prompt || body?.query || "");
  return Math.max(1, Math.ceil(text.length / 4));
}

function requestedOutputTokens(body, remaining) {
  const requested = body?.max_completion_tokens ?? body?.max_tokens ?? body?.max_output_tokens;
  if (requested == null) return remaining;
  return Math.min(remaining, Math.max(1, Number(requested) || 1));
}

function cappedBody(body, outputTokens) {
  if (body?.max_completion_tokens != null) return { ...body, max_completion_tokens: outputTokens };
  if (body?.max_output_tokens != null) return { ...body, max_output_tokens: outputTokens };
  return { ...body, max_tokens: outputTokens };
}

export async function authorizeApiKeyRequest(request, { model, body, reserveTokens = false } = {}) {
  const settings = await getSettings();
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    if (settings.requireApiKey) return { error: errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key") };
    return { apiKey: null, body };
  }

  const key = await getApiKeyByValue(apiKey);
  const expired = key?.expiresAt && new Date(key.expiresAt).getTime() <= Date.now();
  if (!key?.isActive || expired) return { error: errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key") };
  if (Array.isArray(key.allowedModels) && key.allowedModels.length && model) {
    const requestedModel = typeof body?.model === "string" ? body.model : null;
    if (!key.allowedModels.includes(model) && !key.allowedModels.includes(requestedModel)) {
      return { error: errorResponse(HTTP_STATUS.FORBIDDEN, "This API key is not allowed to use the selected model") };
    }
  }
  if (!reserveTokens || key.tokenLimit == null) return { apiKey, key, body };

  const remaining = key.tokenLimit - key.tokensUsed - key.tokensReserved;
  const inputTokens = tokenEstimate(body);
  if (remaining <= inputTokens) return { error: errorResponse(HTTP_STATUS.FORBIDDEN, "API key token quota exceeded") };
  const outputTokens = requestedOutputTokens(body, Math.max(0, remaining - inputTokens));
  const reservation = await reserveApiKeyTokens(apiKey, inputTokens + outputTokens);
  if (!reservation.ok) return { error: errorResponse(HTTP_STATUS.FORBIDDEN, reservation.error) };
  return { apiKey, key, body: cappedBody(body, outputTokens), reservation: reservation.reserved };
}

export async function settleApiKeyReservation(apiKey, reservation, usage) {
  if (!apiKey || !reservation) return;
  const total = Number(usage?.total_tokens ?? usage?.totalTokens)
    || Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) + Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  await settleApiKeyTokens(apiKey, reservation, total);
}
