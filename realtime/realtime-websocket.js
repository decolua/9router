const openAI = require("./openai-realtime-websocket.js");
const codex = require("./codex-websocket.js");
const openAIModels = new Set(require("./realtime-models.cjs"));

// ponytail: explicit model mappings only; add a distinct handler when another protocol is supported.
module.exports = function realtimeWebSocket(server, req, socket, head, handlers = { openAI, codex }) {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { return false; }
  if (url.pathname === "/v1/codex-voice/ws") return handlers.codex(server, req, socket, head);
  if (url.pathname !== "/v1/realtime") return false;
  const models = url.searchParams.getAll("model");
  const model = models[0] || "";
  if (models.length === 1 && model === "cx/gpt-live-1-codex") return handlers.codex(server, req, socket, head);
  const bare = model.startsWith("openai/") ? model.slice(7) : model;
  if (models.length === 1 && (openAIModels.has(bare) || model.startsWith("pollinations/"))) return handlers.openAI(server, req, socket, head);
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  return true;
};