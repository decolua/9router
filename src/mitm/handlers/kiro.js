const err = (msg) => console.error(`[${new Date().toLocaleTimeString("en-US", { hour12: false })}] ❌ [MITM] ${msg}`);
const { fetchRouter, pipeSSE } = require("./base.js");

/**
 * Intercept Kiro request — replace model and forward to router
 */
async function intercept(req, res, bodyBuffer, mappedModel) {
  try {
    const body = JSON.parse(bodyBuffer.toString());
    body.model = mappedModel;
    const routerRes = await fetchRouter(body, "/v1/chat/completions", req.headers);
    await pipeSSE(routerRes, res);
  } catch (error) {
    err(`[Kiro] ${error.message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
  }
}

module.exports = { intercept };
