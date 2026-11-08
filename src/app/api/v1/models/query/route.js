import { buildModelsList, filterModels, VALID_CAPABILITIES } from "../route.js";

// Structured shortlist endpoint. Stateless — no DB writes, same catalog as
// GET /v1/models, with the extra max_output / owned_by / exclude predicates and
// a deterministic, bounded result. Lives at a static `query` segment: Next.js
// resolves it ahead of the [...model] catch-all (which exports no POST).
const LLM_KIND = "llm";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

function badRequest(message, extra = {}) {
  return Response.json(
    { error: { message, type: "invalid_request_error", ...extra } },
    { status: 400, headers: CORS_HEADERS },
  );
}

function parseList(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseOptionalInteger(value, name) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, response: badRequest(`${name} must be an integer.`) };
  }
  return { ok: true, value: n };
}

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Code-unit comparison (not localeCompare) so the order is identical everywhere.
function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareModels(a, b) {
  return compareCodeUnits(a.owned_by || "", b.owned_by || "")
    || compareCodeUnits(a.id || "", b.id || "");
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * POST /v1/models/query — filtered model shortlist.
 * Body: { capabilities?, min_context?, max_output?, kind?, q?, owned_by?, exclude?, limit? }
 */
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Request body must be valid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return badRequest("Request body must be a JSON object.");
    }

    // Same vocabulary as the GET filter, so the two surfaces can't drift.
    const capabilities = parseList(body.capabilities);
    const unknown = capabilities.filter((cap) => !VALID_CAPABILITIES.includes(cap));
    if (unknown.length > 0) {
      return badRequest(
        `Unknown capability${unknown.length === 1 ? "" : "ies"}: ${unknown.map((c) => `"${c}"`).join(", ")}. Valid: ${[...VALID_CAPABILITIES].sort().join(", ")}.`,
        { allowed: VALID_CAPABILITIES },
      );
    }

    const minContext = parseOptionalInteger(body.min_context, "min_context");
    if (!minContext.ok) return minContext.response;
    const maxOutput = parseOptionalInteger(body.max_output, "max_output");
    if (!maxOutput.ok) return maxOutput.response;

    let limit = DEFAULT_LIMIT;
    if (body.limit !== undefined && body.limit !== null && body.limit !== "") {
      const parsed = parseOptionalInteger(body.limit, "limit");
      if (!parsed.ok) return parsed.response;
      if (parsed.value <= 0) return badRequest("limit must be a positive integer.");
      limit = Math.min(parsed.value, MAX_LIMIT); // hard cap
    }

    const models = await buildModelsList([LLM_KIND]);
    const filtered = filterModels(models, {
      capabilities,
      min_context: minContext.value,
      max_output: maxOutput.value,
      kind: asTrimmedString(body.kind) || null,
      q: asTrimmedString(body.q) || null,
      owned_by: asTrimmedString(body.owned_by) || null,
      exclude: parseList(body.exclude),
    });

    const data = filtered.slice().sort(compareModels).slice(0, limit);

    return Response.json({ object: "list", data }, { headers: CORS_HEADERS });
  } catch (error) {
    console.log("Error querying models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
