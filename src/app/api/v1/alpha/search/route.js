import { parseJsonBodyDetailed } from "@/shared/utils/parseJsonBody.js";
import {
  shouldOfficialPassthrough,
  handleOfficialPassthrough,
} from "open-sse/utils/officialPassthrough.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "@/sse/utils/logger.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/alpha/search — Codex webrun (tools.web__run) endpoint.
 *
 * When Codex uses base_url=http://localhost:20128/v1 with name=OpenAI, webrun
 * posts here. Official passthrough forwards to
 * https://chatgpt.com/backend-api/codex/alpha/search.
 *
 * Non-Codex clients or non-matching models get a clear JSON error (not HTML).
 */
export async function POST(request) {
  let body;
  let rawBody = null;
  let contentEncoding = null;
  try {
    const parsed = await parseJsonBodyDetailed(request);
    body = parsed.body;
    rawBody = parsed.rawBody;
    contentEncoding = parsed.contentEncoding;
  } catch (err) {
    log.warn("ALPHA_SEARCH", "Invalid JSON body", { error: err?.message });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const pathname = new URL(request.url).pathname;
  const headers = Object.fromEntries(request.headers.entries());

  if (!shouldOfficialPassthrough({ headers, body, pathname })) {
    log.warn("ALPHA_SEARCH", "Not eligible for official passthrough", {
      model: body?.model,
      path: pathname,
    });
    return errorResponse(
      HTTP_STATUS.NOT_FOUND,
      "Codex webrun (/v1/alpha/search) requires Codex client + official modelPatterns (default gpt-*/codex-*)"
    );
  }

  return handleOfficialPassthrough(request, body, {
    log,
    pathname,
    rawBody,
    contentEncoding,
  });
}
