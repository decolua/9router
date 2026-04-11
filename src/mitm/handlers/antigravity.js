const { err } = require("../logger");
const { fetchRouter, pipeSSE } = require("./base");

/**
 * Convert a Gemini GenerateContent request body to an OpenAI chat.completions body.
 *
 * Antigravity sends native Gemini format (contents, generationConfig, tools, …).
 * Forwarding this raw body to /v1/chat/completions fails because that endpoint
 * expects OpenAI format — the unknown fields (thinkingConfig, generationConfig,
 * etc.) are either ignored or cause upstream providers to return 400.
 *
 * @param {object} geminiBody  - parsed Gemini request
 * @param {string} model       - resolved 9router model string (e.g. "ag/claude-opus-4-6-thinking")
 * @param {boolean} stream     - whether the original request was streaming
 * @returns {object} OpenAI-compatible body
 */
function convertGeminiToOpenAI(geminiBody, model, stream) {
  const messages = [];

  // System instruction
  if (geminiBody.systemInstruction) {
    const systemText = (geminiBody.systemInstruction.parts || [])
      .map(p => p.text)
      .filter(Boolean)
      .join("\n");
    if (systemText) messages.push({ role: "system", content: systemText });
  }

  // Chat turns
  for (const content of geminiBody.contents || []) {
    const role = content.role === "model" ? "assistant" : "user";
    const text = (content.parts || []).map(p => p.text).filter(Boolean).join("\n");
    messages.push({ role, content: text });
  }

  const openaiBody = {
    model,
    messages,
    stream: !!stream,
  };

  const cfg = geminiBody.generationConfig || {};
  if (cfg.maxOutputTokens != null) openaiBody.max_tokens = cfg.maxOutputTokens;
  if (cfg.temperature != null)     openaiBody.temperature = cfg.temperature;
  if (cfg.topP != null)            openaiBody.top_p = cfg.topP;
  if (cfg.stopSequences?.length)   openaiBody.stop = cfg.stopSequences;

  return openaiBody;
}

/**
 * Intercept Antigravity (Gemini) request — convert to OpenAI format and
 * forward to the 9Router /v1/chat/completions endpoint.
 *
 * The raw Gemini body must NOT be forwarded as-is: fields like thinkingConfig,
 * generationConfig, and contents are unknown to the OpenAI-compatible endpoint
 * and cause provider-side 400 "invalid argument" errors, especially with
 * thinking-capable models (e.g. ag/claude-opus-4-6-thinking).
 */
async function intercept(req, res, bodyBuffer, mappedModel) {
  try {
    const geminiBody = JSON.parse(bodyBuffer.toString());

    // Streaming intent: Antigravity uses :streamGenerateContent for streaming
    const isStream = (req.url || "").includes(":streamGenerateContent");

    const openaiBody = convertGeminiToOpenAI(geminiBody, mappedModel, isStream);

    const routerRes = await fetchRouter(openaiBody);
    await pipeSSE(routerRes, res);
  } catch (error) {
    err(`[antigravity] ${error.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
  }
}

module.exports = { intercept };
