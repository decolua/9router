const http = require("http");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");
let pendingSetups = 0;

// ponytail: header-authenticated Node clients only; add browser authentication with an explicit origin policy.
module.exports = function codexWebSocket(server, req, socket, head) {
  const url = new URL(req.url, "http://localhost");
  const realtime = url.pathname === "/v1/realtime";
  if (!realtime && url.pathname !== "/v1/codex-voice/ws") return false;
  const reject = (status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  if (req.method !== "GET" || req.headers.origin || url.searchParams.getAll("model").length !== 1 || url.searchParams.get("model") !== "cx/gpt-live-1-codex" || (!req.headers.authorization && !req.headers["x-api-key"]) || !/\bupgrade\b/i.test(req.headers.connection || "") || req.headers["sec-websocket-version"] !== "13" || !/^[+/0-9A-Za-z]{22}==$/.test(req.headers["sec-websocket-key"] || "")) {
    reject("400 Bad Request");
    return true;
  }
  const address = server.address();
  if (!address || typeof address === "string") { reject("503 Service Unavailable"); return true; }
  // ponytail: process-wide admission cap; add per-peer limits for public deployments.
  if (pendingSetups >= 2) { reject("503 Service Unavailable"); return true; }
  pendingSetups++;
  let setupPending = true;
  const finishSetup = () => { if (setupPending) { setupPending = false; pendingSetups--; } };
  const headers = {};
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers["x-api-key"]) headers["x-api-key"] = req.headers["x-api-key"];
  const host = socket.localAddress?.replace(/^::ffff:/, "") || "127.0.0.1";
  const request = (path, method = "POST", body) => http.request({ host, port: address.port, path, method, headers, agent: false });
  const setup = request("/v1/codex-voice?format=pcm16");
  let stream, ws, upload, id, closed = false, pending = false;
  let response, responseTimer, responseDeadline, audioTimer, audioBuffer = [], audioBytes = 0;
  const makeId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "")}`;
  const send = (event, raw = false) => {
    if (closed || !ws || ws.readyState !== 1 || ws.bufferedAmount > 262144) return close();
    try { ws.send(JSON.stringify(raw ? event : { event_id: makeId("event"), ...event })); } catch { close(); }
  };
  const queue = [];
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(responseTimer);
    clearTimeout(audioTimer);
    audioBuffer = [];
    finishSetup();
    setup.destroy();
    stream?.destroy();
    upload?.destroy();
    if (ws && ws.readyState < 2) ws.close();
    if (!ws) socket.destroy();
  };
  socket.once("close", close);
  socket.once("error", close);
  setup.setTimeout(95000, close);
  setup.once("error", close);
  setup.once("response", (res) => {
    finishSetup();
    setup.setTimeout(0);
    stream = res;
    if (res.statusCode !== 200) { res.resume(); reject(`${res.statusCode || 502} Rejected`); closed = true; return; }
    const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
    try { wss.handleUpgrade(req, socket, head, (client) => {
      ws = client;
      ws.on("error", close);
      ws.on("close", close);
      ws.on("message", (data, binary) => {
        if (binary || !id || queue.length >= 50 || ws.bufferedAmount > 262144) return close();
        let event;
        try { event = JSON.parse(data.toString()); } catch {
          if (!realtime) return close();
          send({ type: "error", error: { type: "invalid_request_error", code: "invalid_event", message: "Invalid JSON", param: null, event_id: null } });
          return;
        }
        let action, body;
        const validId = !realtime || event?.event_id === undefined || typeof event.event_id === "string";
        if (validId && event?.type === "response.cancel" && Object.keys(event).every((key) => key === "type" || (realtime && key === "event_id"))) action = "cancel";
        else if (validId && event?.type === "input_audio_buffer.append" && Object.keys(event).every((key) => key === "type" || key === "audio" || (realtime && key === "event_id")) && typeof event.audio === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.audio)) {
          body = Buffer.from(event.audio, "base64");
          if (body.length >= 2 && body.length <= 3840 && body.length % 2 === 0) action = "audio";
        }
        if (!action) {
          if (!realtime) return close();
          send({ type: "error", error: { type: "invalid_request_error", code: "invalid_event", message: "Unsupported or invalid event", param: null, event_id: typeof event?.event_id === "string" ? event.event_id : null } });
          return;
        }
        queue.push({ action, body });
        drain();
      });
      function drain() {
        if (pending || closed || !queue.length) return;
        pending = true;
        const { action, body } = queue.shift();
        upload = request(`/v1/codex-voice?session=${encodeURIComponent(id)}&action=${action}`);
        upload.setTimeout(6000, () => upload.destroy());
        upload.on("error", close);
        upload.on("response", (result) => { result.resume(); if (result.statusCode !== 204) close(); else { pending = false; drain(); } });
        upload.end(body);
      }
    }); } catch { return close(); }
    const finishResponse = () => {
      clearTimeout(responseTimer);
      if (!response) return;
      send({ type: "response.done", response: { object: "realtime.response", id: response.id, status: "incomplete", status_details: { type: "incomplete" }, output: [{ id: response.item, object: "realtime.item", type: "message", status: "incomplete", role: "assistant", content: [{ type: "output_audio", transcript: response.transcript }] }] } });
      response = null;
    };
    // ponytail: control and RTP are unordered; retain only five seconds of PCM and use a bounded quiet tail until media correlation exists.
    const scheduleResponse = () => {
      clearTimeout(responseTimer);
      if (!closed) responseTimer = setTimeout(finishResponse, Math.max(0, Math.min(250, responseDeadline - performance.now())));
    };
    const sendAudio = (payload) => send({ type: "response.output_audio.delta", response_id: response.id, item_id: response.item, output_index: 0, content_index: 0, delta: payload });
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        if (newline > 131072) return close();
        let event;
        try { event = JSON.parse(buffer.slice(0, newline)); } catch { return close(); }
        buffer = buffer.slice(newline + 1);
        if (!event || typeof event !== "object" || Array.isArray(event)) return close();
        if (event.type === "session") {
          id = event.id;
          if (realtime) send({ type: "session.created", session: { id: makeId("sess"), object: "realtime.session", type: "realtime", model: "cx/gpt-live-1-codex", audio: { input: { format: { type: "audio/pcm", rate: 24000 } }, output: { format: { type: "audio/pcm", rate: 24000 } } } } });
          continue;
        }
        if (ws.readyState !== 1 || ws.bufferedAmount > 262144) return close();
        if (realtime) {
          if (event.type === "audio") {
            if (typeof event.payload !== "string" || !event.payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.payload) || Buffer.from(event.payload, "base64").length % 2) return close();
            if (response && performance.now() >= responseDeadline) finishResponse();
            if (response) { sendAudio(event.payload); scheduleResponse(); }
            else if (typeof event.payload === "string" && event.payload.length <= 320000) {
              audioBuffer.push({ payload: event.payload, at: performance.now() });
              audioBytes += event.payload.length;
              while (audioBytes > 320000 || audioBuffer.length > 250 || audioBuffer[0].at < performance.now() - 5000) audioBytes -= audioBuffer.shift().payload.length;
              if (!audioTimer) audioTimer = setTimeout(() => { audioBuffer = []; audioBytes = 0; audioTimer = null; }, 5000);
            }
          } else if (event.event?.type === "turn.done" && event.event.turn?.role === "assistant" && typeof event.event.turn.transcript === "string") {
            finishResponse();
            response = { id: makeId("resp"), item: makeId("item"), transcript: event.event.turn.transcript };
            send({ type: "response.created", response: { object: "realtime.response", id: response.id, status: "in_progress", output: [] } });
            send({ type: "response.output_item.added", response_id: response.id, output_index: 0, item: { id: response.item, object: "realtime.item", type: "message", status: "in_progress", role: "assistant", content: [] } });
            send({ type: "response.content_part.added", response_id: response.id, item_id: response.item, output_index: 0, content_index: 0, part: { type: "audio" } });
            for (const chunk of audioBuffer) if (chunk.at >= performance.now() - 5000) sendAudio(chunk.payload);
            clearTimeout(audioTimer);
            audioTimer = null;
            audioBuffer = []; audioBytes = 0;
            send({ type: "response.output_audio_transcript.done", response_id: response.id, item_id: response.item, output_index: 0, content_index: 0, transcript: response.transcript });
            responseDeadline = performance.now() + 1000;
            scheduleResponse();
          }
          continue;
        }
        // Audio has no upstream item/response identifiers; do not invent OpenAI lifecycle events.
        const output = event.type === "audio" ? { type: "9router.audio.delta", audio: event.payload } : event.event;
        send(output, true);
      }
      if (buffer.length > 131072) return close();
    });
    res.on("end", close);
    res.on("error", close);
  });
  setup.end();
  return true;
};