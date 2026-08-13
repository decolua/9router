// Codex-native ingress: everything under /backend-api/codex that is not
// /responses or /models.
//
// Besides the model call, the Codex CLI/IDE fires a handful of side requests at
// the ChatGPT backend (telemetry, thread goals, memory summarisation, safety).
// They are advisory — Codex works without them — but a hard failure on every
// turn is noisy, so the fire-and-forget ones are acknowledged with an empty
// document. Anything else answers with a normal 404 so an unrecognised Codex
// endpoint shows up in the logs instead of being silently mis-parsed.

const STUBBED = new Map([
  ["analytics-events/events", () => ({})],
  ["thread/goal/get", () => ({})],
  ["thread/goal/set", () => ({})],
  ["thread/goal/clear", () => ({})],
  ["memories/trace_summarize", () => ({})],
  ["safety/arc", () => ({})],
  ["agent-identities/jwks", () => ({ keys: [] })],
]);

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

function respond(path) {
  // Clients that unconditionally append /v1 to the base URL land here too.
  const normalized = path.replace(/^v1\//, "");
  const stub = STUBBED.get(normalized);
  if (stub) return Response.json(stub(), { headers: corsHeaders });
  return Response.json(
    {
      error: {
        message: `Unknown Codex endpoint: /backend-api/codex/${path}`,
        type: "invalid_request_error",
        code: "not_found",
      },
    },
    { status: 404, headers: corsHeaders }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request, { params }) {
  const { path } = await params;
  return respond((path || []).join("/"));
}

export async function POST(request, { params }) {
  const { path } = await params;
  return respond((path || []).join("/"));
}
