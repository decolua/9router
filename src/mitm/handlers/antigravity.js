const { err, createResponseDumper } = require("../logger");
const { IS_DEV } = require("../config");
const { fetchRouter, pipeSSE } = require("./base");

function applyRequestOverrides(body, override = {}) {
  if (override.model) body.model = override.model;
  if (override.reasoningEffort) {
    body.reasoning_effort = override.reasoningEffort;
    delete body.thinkingConfig;
    if (body.generationConfig) delete body.generationConfig.thinkingConfig;
    if (body.request?.generationConfig) delete body.request.generationConfig.thinkingConfig;
  }
  return body;
}

/**
 * Intercept Antigravity request — forward Gemini body as-is to /v1/chat/completions.
 * Router auto-detects format via body.userAgent==="antigravity" + body.request.contents,
 * runs antigravity→openai→provider→openai→antigravity translators internally.
 */
async function intercept(req, res, bodyBuffer, override) {
  const dumper = IS_DEV ? createResponseDumper(req, "intercept-antigravity") : null;
  const isStream = req.url.includes(":streamGenerateContent");
  try {
    const body = applyRequestOverrides(JSON.parse(bodyBuffer.toString()), override);

    const routerRes = await fetchRouter(body, "/v1/chat/completions", req.headers);
    await pipeSSE(routerRes, res, dumper);
  } catch (error) {
    err(`[antigravity] ${error.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${error.message}\n`); dumper.end(); }
    // For stream endpoint, send SSE error chunk so SDK doesn't hang waiting
    if (isStream) {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ error: { message: error.message } })}\r\n\r\n`);
    } else {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
    }
  }
}

module.exports = { intercept, applyRequestOverrides };
