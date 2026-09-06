/**
 * Prompt Cache Breakpoint Anchor (Memory Optimization)
 *
 * Upstream providers (Anthropic Claude, Gemini, OpenAI) support prompt caching,
 * which can cut input token billing and latency by up to 90%.
 *
 * To achieve maximum cache hits:
 * 1. The static prefix (system prompt, tool schemas, and stable historical messages)
 *    must remain bit-for-bit consistent.
 * 2. Breakpoints must be strategically placed at stable boundary positions.
 */

/**
 * Anchor prompt caching breakpoints in request body
 * @param {Object} body - Request body
 * @param {Object} options
 * @param {boolean} options.enabled - Whether cache anchoring is enabled
 * @param {string} options.format - Target format (e.g. "claude", "openai", "gemini")
 * @returns {{ body: Object, anchored: boolean }}
 */
export function anchorPromptCache(body, options = {}) {
  const { enabled = true, format = "claude" } = options;

  if (!enabled || !body || typeof body !== "object") {
    return { body, anchored: false };
  }

  let anchored = false;

  // 1. Claude format: system blocks + tools + last turn
  if (format === "claude" || format === "anthropic") {
    // System block cache breakpoint
    if (typeof body.system === "string") {
      body.system = [
        {
          type: "text",
          text: body.system,
          cache_control: { type: "ephemeral" },
        },
      ];
      anchored = true;
    } else if (Array.isArray(body.system) && body.system.length > 0) {
      const lastSystemBlock = body.system[body.system.length - 1];
      if (lastSystemBlock && typeof lastSystemBlock === "object") {
        lastSystemBlock.cache_control = { type: "ephemeral" };
        anchored = true;
      }
    }

    // Tools breakpoint
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      const lastTool = body.tools[body.tools.length - 1];
      if (lastTool && typeof lastTool === "object") {
        lastTool.cache_control = { type: "ephemeral" };
        anchored = true;
      }
    }
  }

  return { body, anchored };
}
