// Tokenizer helper — accurate token counting with graceful fallback.
// Tries to load js-tiktoken / @dqbd/tiktoken if installed, otherwise falls back to chars/4 heuristic.
// All callers should treat estimate as approximate; provider-reported usage is source of truth for billing.

// Lazy tiktoken encoder (singleton, may remain null if not installed)
let encoder = null;
let encLoadAttempted = false;

// bundler-ignored optional import: js-tiktoken/@dqbd/tiktoken are NOT guaranteed to
// be installed. webpackIgnore tells Next.js/webpack to skip build-time resolution of
// these specifiers (otherwise it emits "Module not found" warnings). Bun/Node ignore
// the magic comment entirely and attempt the real import at runtime.
async function tryOptionalImport(name) {
  try { return await import(/* webpackIgnore: true */ name); } catch { return null; }
}

async function getEncoder() {
  if (encLoadAttempted) return encoder;
  encLoadAttempted = true;
  // Try js-tiktoken (pure JS, no native) first
  const jsTikToken = await tryOptionalImport("js-tiktoken");
  if (jsTikToken?.encodingForModel) {
    try { encoder = jsTikToken.encodingForModel("gpt-4o"); } catch { encoder = jsTikToken.getEncoding("cl100k_base"); }
    return encoder;
  }
  const tikToken = await tryOptionalImport("@dqbd/tiktoken");
  if (tikToken?.encoding_for_model) {
    try { encoder = await tikToken.encoding_for_model("gpt-4o"); } catch { encoder = await tikToken.get_encoding("cl100k_base"); }
    return encoder;
  }
  return null;
}

const CHARS_PER_TOKEN_FALLBACK = 4;

/**
 * Count tokens in a string. Returns estimated integer >=0.
 * If a real tokenizer is available, uses it; otherwise chars/4.
 */
export function countTokensText(text, modelHint) {
  if (!text || typeof text !== "string") return 0;
  if (encoder?.encode) {
    try {
      // js-tiktoken & tiktoken both expose encode(text) -> number[]
      const tokens = encoder.encode(text);
      return Array.isArray(tokens) ? tokens.length : tokens?.length || Math.ceil(text.length / CHARS_PER_TOKEN_FALLBACK);
    } catch {}
  }
  // Fallback heuristic: ~4 chars per token (conservative for English/code)
  return Math.ceil(text.length / CHARS_PER_TOKEN_FALLBACK);
}

/**
 * Count tokens in a request body (messages/input/contents/tools).
 * Approximate by JSON-stringifying the relevant slices (same as provider payload).
 */
export function countTokensBody(body) {
  if (!body || typeof body !== "object") return 0;
  try {
    // Cheap: stringify whole body; byte/char overhead approximates token overhead
    const s = JSON.stringify(body);
    return countTokensText(s);
  } catch {
    return 0;
  }
}

/**
 * Detailed breakdown: system, tools, messages, toolHistory tokens.
 */
export function breakdownTokens(body) {
  const out = { total: 0, system: 0, tools: 0, messages: 0, toolHistory: 0 };
  if (!body || typeof body !== "object") return out;
  try {
    out.tools = countTokensText(JSON.stringify(body.tools || []));
    const msgs = body.messages || body.input || body.contents || [];
    out.messages = countTokensText(JSON.stringify(msgs));
    // toolHistory subset
    const toolHistory = Array.isArray(msgs) ? msgs.filter((m) => m?.role === "tool" || m?.role === "function" || m?.tool_calls?.length || m?.content?.some?.((p) => p?.type === "tool_use" || p?.type === "tool_result")) : [];
    out.toolHistory = countTokensText(JSON.stringify(toolHistory));
    // system slice
    const systemMsgs = Array.isArray(msgs) ? msgs.filter((m) => m?.role === "system" || m?.role === "developer" || m?.type === "system") : [];
    // Also top-level system string (claude)
    if (typeof body.system === "string") systemMsgs.push({ content: body.system });
    if (systemMsgs.length) out.system = countTokensText(JSON.stringify(systemMsgs));
    out.total = countTokensBody(body);
  } catch {}
  return out;
}

/**
 * Whether a real tokenizer is loaded (vs heuristic).
 */
export function hasRealTokenizer() {
  return !!encoder?.encode;
}

/**
 * Async init — call at startup to warm the encoder (non-blocking).
 */
export async function initTokenizer() {
  await getEncoder();
  return hasRealTokenizer();
}
