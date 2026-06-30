import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

function isCodexUserAgent(request) {
  const originator = request.headers.get("originator") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  return originator === "codex_cli_rs" || /codex/i.test(userAgent);
}

function toCodexModel(m) {
  const provider =
    typeof m.id === "string" && m.id.includes("/")
      ? m.id.split("/")[0] ?? ""
      : (m.owned_by ?? "");
  const caps = getCapabilitiesForModel(provider, m.id);
  return {
    slug: m.id,
    display_name: m.id,
    supported_in_api: true,
    supports_search_tool: !!caps?.search,
    tool_mode: "auto",
    multi_agent_version: null,
  };
}

/**
 * Build the /v1/models response, shaping it for Codex CLI when detected.
 *
 * @param {Request} request
 * @param {object[]} data
 * @returns {Response}
 */
export function buildModelsResponse(request, data) {
  const headers = { "Access-Control-Allow-Origin": "*" };
  if (isCodexUserAgent(request)) {
    return Response.json({ models: data.map(toCodexModel) }, { headers });
  }
  return Response.json({ object: "list", data }, { headers });
}
