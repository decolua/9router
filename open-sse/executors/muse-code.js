/**
 * Muse Code CLI executor.
 *
 * Muse CLI speaks the OpenAI Responses API to {base}/v1/responses. Requests
 * arrive via 9Router's /v1/responses route with sourceFormat openai-responses;
 * the Responses→Chat translator (openai-responses.js) already converts input/
 * instructions/tools to messages[] for whatever upstream provider the model
 * maps to. This executor only fixes Muse-specific quirks that generic chat
 * upstreams reject:
 *
 *  1. Namespace tool groups — Muse bundles tools as { type:"namespace", name,
 *     tools:[...] }; chat providers only understand flat function tools, so
 *     flatten children into ordinary tools (same as muse-shim).
 *  2. Reasoning effort — Muse sends xhigh/ultra which some upstreams reject;
 *     clamp to the provider's declared max via injectReasoningContent rules.
 *
 * Everything else (tool_call sequencing, streaming, Responses SSE out) is
 * handled by the existing Responses translator + SSE transform pipeline.
 */
import { DefaultExecutor } from "./default.js";

// Muse sends namespace tool groups; chat upstreams need flat function tools.
// A namespace has no function signature of its own — children carry them.
function flattenNamespaceTools(tools) {
  if (!Array.isArray(tools)) return tools;
  const flattened = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
    if (tool.type === "namespace" && Array.isArray(tool.tools)) {
      for (const child of tool.tools) {
        if (!child || typeof child !== "object" || Array.isArray(child)) continue;
        if (typeof child.name === "string" && child.name.trim()) flattened.push(child);
      }
      continue;
    }
    flattened.push(tool);
  }
  return flattened;
}

export class MuseCodeExecutor extends DefaultExecutor {
  constructor() {
    super("muse-code");
  }

  transformRequest(model, body) {
    if (body && typeof body === "object") {
      if (Array.isArray(body.tools)) {
        body.tools = flattenNamespaceTools(body.tools);
        if (body.tools.length === 0) {
          delete body.tools;
          delete body.tool_choice;
        }
      }
      // Muse's default max_output_tokens (1M context / 131k output) may exceed
      // what chat upstreams accept; let the provider clamp it.
      if (body.max_output_tokens !== undefined && typeof body.max_output_tokens === "number") {
        body.max_tokens = Math.min(body.max_output_tokens, 131072);
        delete body.max_output_tokens;
      }
    }
    return super.transformRequest(model, body);
  }
}

export default MuseCodeExecutor;