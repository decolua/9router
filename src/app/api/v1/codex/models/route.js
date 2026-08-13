import { buildModelsList } from "../../models/route.js";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Codex clients pointed at a `/backend-api/codex` base URL fetch their catalog
// from `<base_url>/models` and expect the Codex shape (`{ "models": [...] }`).
// The OpenAI-compatible `{ object, data }` shape fails to parse client-side and
// Codex silently falls back to its bundled metadata (stale context windows and
// reasoning levels), so serve both shapes in one body: `models` for Codex,
// `data` for anything else that follows the OpenAI list contract.

const REASONING_LEVELS = [
  { effort: "minimal", description: "Fastest responses with limited reasoning." },
  { effort: "low", description: "Balances speed with some reasoning." },
  { effort: "medium", description: "Default reasoning depth." },
  { effort: "high", description: "Maximizes reasoning depth for complex problems." },
];

// Codex truncates tool output client-side using this policy. Tokens/10k matches
// the upstream default for every model except gpt-5.2 (which is byte-based).
const truncationPolicyFor = (slug) => (
  slug.endsWith("/gpt-5.2") || slug === "gpt-5.2"
    ? { mode: "bytes", limit: 10000 }
    : { mode: "tokens", limit: 10000 }
);

const ALIAS_TO_PROVIDER_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
);

// "cx/gpt-5.6-sol" -> capabilities for provider `codex`, model `gpt-5.6-sol`.
// Combos and unprefixed ids fall back to the capability defaults.
function capabilitiesFor(modelId) {
  const slash = modelId.indexOf("/");
  if (slash === -1) return getCapabilitiesForModel(null, modelId);
  const alias = modelId.slice(0, slash);
  const bareId = modelId.slice(slash + 1);
  return getCapabilitiesForModel(ALIAS_TO_PROVIDER_ID[alias] || alias, bareId);
}

function inputModalities(caps) {
  const modalities = ["text"];
  if (caps?.vision) modalities.push("image");
  return modalities;
}

function toCodexEntry(model) {
  const caps = model.capabilities?.contextWindow ? model.capabilities : capabilitiesFor(model.id);
  const reasoning = caps?.reasoning === true;
  return {
    slug: model.id,
    display_name: model.id,
    description: `${model.owned_by || "10router"} via 10router`,
    base_instructions: "",
    default_reasoning_level: reasoning ? "medium" : null,
    supported_reasoning_levels: reasoning ? REASONING_LEVELS : [],
    supported_in_api: true,
    priority: 0,
    minimal_client_version: null,
    supports_reasoning_summaries: reasoning,
    support_verbosity: false,
    default_verbosity: null,
    supports_parallel_tool_calls: caps?.tools !== false,
    context_window: caps?.contextWindow || 200000,
    max_output_tokens: caps?.maxOutput || undefined,
    input_modalities: inputModalities(caps),
    available_in_plans: [],
    prefer_websockets: false,
    visibility: "list",
    truncation_policy: truncationPolicyFor(model.id),
    experimental_supported_tools: [],
  };
}

function toOpenAIEntry(entry, created) {
  return {
    id: entry.slug,
    object: "model",
    created,
    owned_by: "10router",
    metadata: {
      display_name: entry.display_name,
      description: entry.description,
      context_window: entry.context_window,
      max_output_tokens: entry.max_output_tokens ?? null,
      input_modalities: entry.input_modalities,
      supported_reasoning_levels: entry.supported_reasoning_levels,
      default_reasoning_level: entry.default_reasoning_level,
      supports_reasoning_summaries: entry.supports_reasoning_summaries,
      supports_parallel_tool_calls: entry.supports_parallel_tool_calls,
      supported_in_api: true,
      priority: 0,
    },
  };
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /backend-api/codex/models - Codex-native model catalog
 */
export async function GET() {
  try {
    const models = await buildModelsList(["llm"]);
    const created = Math.floor(Date.now() / 1000);
    const entries = models.map(toCodexEntry);
    return Response.json(
      {
        models: entries,
        object: "list",
        data: entries.map((entry) => toOpenAIEntry(entry, created)),
      },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (error) {
    console.log("Error building codex models catalog:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
