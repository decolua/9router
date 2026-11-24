import { getApiKeyByKey, getApiKeyPeriodSpend } from "@/lib/db/index.js";
import { extractClientApiKey } from "@/sse/services/keyAccess.js";
import { keyLimitStatus } from "@/shared/utils/keyQuota.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * GET /v1/limits - budgets, spend and expiry of the presented API key.
 * Reports only on the key in the request (never other keys, never the secret),
 * so it is safe to call from clients such as a Claude Code status line.
 */
export async function GET(request) {
  const apiKey = extractClientApiKey(request);
  const record = apiKey ? await getApiKeyByKey(apiKey) : null;
  if (!record) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "A valid 9Router API key is required");
  const status = keyLimitStatus(record, await getApiKeyPeriodSpend(record.key));
  return Response.json(status, { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}
