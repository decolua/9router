// Codex-native ingress: POST /backend-api/codex/responses
//
// The Codex CLI/IDE talks to `<base_url>/responses` when it is configured with
// `wire_api = "responses"`. Pointing it at the plain `/v1` ingress works, but
// Codex only serves its native model catalog and ChatGPT-style auth from a
// `/backend-api/codex` base URL — so this mirror exists to accept that shape.
// The body is the same OpenAI Responses payload, so it reuses the /v1/responses
// handler untouched (see next.config.mjs for the /backend-api/codex rewrites).
import { POST as responsesPost } from "../../responses/route.js";
import { getPooledCodexRateLimitHeaders } from "@/sse/services/codexPooledUsage";

export { OPTIONS } from "../../responses/route.js";

export async function POST(request) {
  const response = await responsesPost(request);

  // Codex reads its usage bar off these headers rather than from an endpoint.
  // Requests are served from all connected Codex accounts, so report the pooled
  // number. Cached and refreshed in the background — never blocks the reply.
  const pooled = getPooledCodexRateLimitHeaders();
  if (Object.keys(pooled).length === 0) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(pooled)) headers.set(name, value);

  // Re-wrap rather than mutate: a streamed body must pass through untouched.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
