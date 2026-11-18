import { randomUUID } from "node:crypto";

// ponytail: process-local sessions require sticky routing; use shared coordination for replicas.
export function createRealtimeSessions({ authenticate, authorize, connect }) {
  const sessions = new Map();
  const reply = (status, error) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  return async function handle(request) {
    const key = await authenticate(request);
    if (!key) return reply(401, "Invalid API key");
    const url = new URL(request.url);
    const id = url.searchParams.get("session");
    if (!id) {
      if (request.method !== "POST") return reply(405, "Method not allowed");
      const format = url.searchParams.get("format") || "opus";
      if (format !== "opus" && format !== "pcm16") return reply(400, "Invalid audio format");
      const denied = await authorize(request, key);
      if (denied) return denied;
      if (sessions.size >= 2) return reply(503, "Realtime capacity reached");
      const session = { key, format, abort: new AbortController() };
      const sessionId = randomUUID();
      sessions.set(sessionId, session);
      const close = () => {
        if (!sessions.delete(sessionId)) return;
        session.abort.abort();
        request.signal.removeEventListener("abort", close);
        clearInterval(session.timer);
        try { session.controller?.close(); } catch {}
        void session.bridge?.close().catch(() => {});
      };
      session.close = close;
      const abortSetup = close;
      request.signal.addEventListener("abort", abortSetup, { once: true });
      if (request.signal.aborted) abortSetup();
      const deadline = setTimeout(close, 90000);
      try {
        const pending = Promise.resolve().then(() => connect(session.abort.signal, format));
        pending.then((bridge) => { if (session.abort.signal.aborted) void bridge.close().catch(() => {}); }, () => {});
        session.bridge = await Promise.race([pending, new Promise((_, reject) => {
          if (session.abort.signal.aborted) reject(new Error("Disconnected"));
          else session.abort.signal.addEventListener("abort", () => reject(new Error("Disconnected")), { once: true });
        })]);
        if (session.abort.signal.aborted) throw new Error("Disconnected");
      } catch (error) {
        close();
        return reply(error.status === 503 ? 503 : 502, "Realtime connection failed");
      } finally {
        clearTimeout(deadline);
        request.signal.removeEventListener("abort", abortSetup);
      }
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) { close(); return reply(502, "Realtime connection failed"); }
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          session.controller = controller;
          const emit = (data) => {
            if (controller.desiredSize <= 0) throw new Error("Client too slow");
            controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
          };
          emit({ type: "session", id: sessionId, ...(format === "pcm16" ? { format: "pcm16", sample_rate: 24000, channels: 1 } : {}) });
          const pump = async (source, type) => {
            const reader = source.getReader();
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (type === "audio") emit(format === "pcm16" ? { type, payload: Buffer.from(value).toString("base64") } : { type, sequence: value.sequenceNumber, timestamp: value.timestamp, payload: Buffer.from(value.payload).toString("base64") });
                else emit({ type, event: value });
              }
            } catch (error) { try { controller.error(error); } catch {} }
            finally { close(); try { controller.close(); } catch {} }
          };
          const checkAccess = async () => {
            try { if (await authenticate(request) !== key || await authorize(request, key)) { close(); try { controller.close(); } catch {} } }
            catch { close(); try { controller.close(); } catch {} }
            if (!session.abort.signal.aborted) session.timer = setTimeout(checkAccess, 5000);
          };
          session.timer = setTimeout(checkAccess, 5000);
          void pump(session.bridge.audio, "audio");
          void pump(session.bridge.events, "event");
        },
        cancel() { close(); },
      }, { highWaterMark: 256 });
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
    }
    const session = sessions.get(id);
    if (!session || session.key !== key) return reply(404, "Session not found");
    const denied = await authorize(request, key);
    if (denied) { session.close(); return denied; }
    if (request.method === "DELETE") { session.close(); return new Response(null, { status: 204 }); }
    if (request.method !== "POST") return reply(405, "Method not allowed");
    const action = url.searchParams.get("action");
    if (action === "cancel") {
      // ponytail: ten cancels per second per session; add configurable limits if needed.
      const now = Date.now();
      session.cancelBudget = Math.min(10, (session.cancelBudget ?? 10) + Math.max(0, now - (session.lastCancel ?? now)) / 100);
      session.lastCancel = now;
      if (session.cancelBudget < 1) return reply(429, "Cancel rate limit exceeded");
      session.cancelBudget--;
      try { session.bridge.cancelResponse(); return new Response(null, { status: 204 }); }
      catch { session.close(); return reply(502, "Realtime session closed"); }
    }
    if (action !== "audio") return reply(400, "Invalid action");
    if (Number(request.headers.get("content-length")) > 4096) return reply(413, "Audio packet too large");
    if (session.uploading) return reply(429, "Audio upload already in progress");
    session.uploading = true;
    let reader;
    const uploadSignal = AbortSignal.any([session.abort.signal, request.signal, AbortSignal.timeout(5000)]);
    const cancelUpload = () => { void reader?.cancel().catch(() => {}); };
    uploadSignal.addEventListener("abort", cancelUpload, { once: true });
    try {
      reader = request.body?.getReader();
      if (!reader) return reply(400, "Missing audio packet");
      if (uploadSignal.aborted) return reply(400, "Audio upload cancelled");
      const chunks = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value.length) continue;
        size += value.length;
        if (size > 4096) { await reader.cancel(); return reply(413, "Audio packet too large"); }
        chunks.push(value);
      }
      if (uploadSignal.aborted || await authenticate(request) !== key) return reply(401, "Invalid API key");
      const denied = await authorize(request, key);
      if (denied) { session.close(); return denied; }
      if (uploadSignal.aborted) return reply(400, "Audio upload cancelled");
      session.bridge.sendAudio(Buffer.concat(chunks));
      return new Response(null, { status: 204 });
    } catch { return reply(400, "Invalid audio packet or rate limit exceeded"); }
    finally { uploadSignal.removeEventListener("abort", cancelUpload); session.uploading = false; }
  };
}