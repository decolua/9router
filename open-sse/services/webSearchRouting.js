// Ported from OmniRoute open-sse/services/webSearchRouting.ts (layer 2). Operators can
// set settings.webSearchRouteModel to route the WHOLE request carrying a native web-search
// tool to a model that runs web search natively (claude-code-router Router.webSearch
// style), instead of relying on the layer-1 function fallback. Pure, no I/O.

function asString(value) {
  return typeof value === "string" ? value : "";
}

// True when the raw client body declares a NATIVE web-search server tool (web_search,
// web_search_preview, or any Anthropic dated variant). A custom function tool that merely
// happens to be named "web_search" carries a `function` field and is ignored. Prefix
// match on purpose: at the entrypoint the tool is still in the client's raw form.
export function hasNativeWebSearchTool(body) {
  if (!body || typeof body !== "object") return false;
  const tools = body.tools;
  if (!Array.isArray(tools)) return false;
  return tools.some((tool) => {
    if (!tool || typeof tool !== "object") return false;
    if (tool.function) return false;
    return asString(tool.type).startsWith("web_search");
  });
}

// Routes only when (a) the request carries a native web-search tool, (b)
// webSearchRouteModel is non-empty, and (c) it differs from the current model. The
// returned model string is resolved downstream by the normal routing pipeline.
export function resolveWebSearchRouteOverride(currentModel, body, settings) {
  const fallthrough = { wasRouted: false, model: currentModel };
  if (!hasNativeWebSearchTool(body)) return fallthrough;

  const configured = asString(settings?.webSearchRouteModel).trim();
  if (!configured || configured === currentModel) return fallthrough;

  return { wasRouted: true, model: configured };
}
