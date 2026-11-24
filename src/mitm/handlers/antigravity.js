const { err, createResponseDumper } = require("../logger");
const { IS_DEV } = require("../config");
const { fetchRouter, pipeSSE } = require("./base");

/**
 * Intercept Antigravity request — forward Gemini body as-is to /v1/chat/completions.
 * Router auto-detects format via body.userAgent==="antigravity" + body.request.contents,
 * runs antigravity→openai→provider→openai→antigravity translators internally.
 */
async function intercept(req, res, bodyBuffer, mappedModel, options) {
  const dumper = IS_DEV && !options?.disableRawDump && !process.env.ANTIGRAVITY_BYOK_AUDIT_FILE ? createResponseDumper(req, "intercept-antigravity") : null;
  const isStream = /:(?:cascade)?streamGenerateContent/i.test(req.url || "");
  try {
    const body = JSON.parse(bodyBuffer.toString());
    body.model = mappedModel;

    // Only forward protocol hints in BYOK mode. The IDE's authorization,
    // cookies, and other client headers are unrelated to the target provider.
    const clientHeaders = options?.disableRawDump
      ? Object.fromEntries(Object.entries(req.headers || {}).filter(([key]) => ["user-agent", "accept"].includes(key.toLowerCase())))
      : req.headers;
    const routerRes = await fetchRouter(body, "/v1/chat/completions", clientHeaders);
    if (typeof options?.onResponse === "function") options.onResponse(routerRes.status);
    await pipeSSE(routerRes, res, dumper);
  } catch (error) {
    if (options?.disableRawDump) err("[antigravity] BYOK router request failed");
    else err(`[antigravity] ${error.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${error.message}\n`); dumper.end(); }
    // For stream endpoint, send SSE error chunk so SDK doesn't hang waiting
    if (isStream) {
      if (!res.headersSent) res.writeHead(options?.disableRawDump ? 502 : 200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ error: { message: options?.disableRawDump ? "BYOK router request failed" : error.message } })}\r\n\r\n`);
    } else {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: options?.disableRawDump ? "BYOK router request failed" : error.message, type: "mitm_error" } }));
    }
  }
}

module.exports = { intercept };
