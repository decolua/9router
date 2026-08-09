import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getSettings } from "@/lib/localDb";
import { forwardCodexSearch, normalizeCodexSearchBody } from "open-sse/handlers/codexSearch.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

async function validateClientApiKey(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;

  const apiKey = extractApiKey(request);
  if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
  if (!(await isValidApiKey(apiKey))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  return null;
}

export async function handleCodexSearch(request) {
  const authError = await validateClientApiKey(request);
  if (authError) return authError;

  let body;
  try {
    body = normalizeCodexSearchBody(await request.json());
  } catch (error) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, error instanceof SyntaxError ? "Invalid JSON body" : error.message);
  }

  const model = typeof body.model === "string" && body.model ? body.model : "__codex_search";
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials("codex", excludeConnectionIds, model);
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        const message = lastError || credentials.lastError || "Codex search unavailable";
        return unavailableResponse(status, message, credentials.retryAfter, credentials.retryAfterHuman);
      }
      return errorResponse(
        excludeConnectionIds.size ? (lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE) : HTTP_STATUS.NOT_FOUND,
        lastError || "No active credentials for provider: codex"
      );
    }

    const refreshed = await checkAndRefreshToken("codex", credentials);
    const result = await forwardCodexSearch({
      body,
      credentials: refreshed,
      clientHeaders: request.headers,
      signal: request.signal,
      log,
    });

    if (result.success) {
      await clearAccountError(credentials.connectionId, credentials, model);
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      result.status,
      result.error,
      "codex",
      model
    );

    if (!shouldFallback) return result.response;

    excludeConnectionIds.add(credentials.connectionId);
    lastError = result.error;
    lastStatus = result.status;
  }
}
