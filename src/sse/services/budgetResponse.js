// Parse the provider stream once. Billing sees only the raw usage trailer;
// translated client events (including synthesized usage) are never billable.
export function meteredStream(body, finish, renderer = null) {
  const reader = body.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
  const maxFrame = 262144;
  let pending = "", data = [], frameSize = 0, usage = null, ended = false, partial = false;
  function line(text) {
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (!text) {
      const payload = data.join("\n");
      data = []; frameSize = 0;
      if (!payload || ended) return "";
      if (payload === "[DONE]") { ended = true; return ""; }
      let event;
      try { event = JSON.parse(payload); } catch { usage = null; return ""; }
      usage = Array.isArray(event?.choices) && !event.choices.length ? event.usage : null;
      return renderer?.chunk(event) || "";
    } else if (text.startsWith("data:")) {
      frameSize += text.length;
      if (frameSize > maxFrame) partial = true;
      else data.push(text.slice(5).trimStart());
    }
    return "";
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            const complete = ended && !partial;
            if (renderer && !complete) throw new Error("Incomplete provider stream");
            const tail = renderer?.end(usage);
            finish(complete ? usage : null);
            if (tail) controller.enqueue(encoder.encode(tail));
            controller.close();
            return;
          }
          let rendered = "";
          if (!partial) {
            const lines = (pending + decoder.decode(value, { stream: true })).split("\n");
            pending = lines.pop();
            for (const text of lines) { rendered += line(text); if (partial) break; }
            if (pending.length > maxFrame) partial = true;
          }
          if (!renderer) { controller.enqueue(value); return; }
          if (partial) throw new Error("Oversized provider event");
          if (rendered) { controller.enqueue(encoder.encode(rendered)); return; }
        }
      } catch (e) {
        finish(null);
        controller.error(e);
        void reader.cancel(e).catch(() => {});
      }
    },
    async cancel(reason) {
      try { finish(null); } finally { await reader.cancel(reason); }
    },
  }, { highWaterMark: 0 });
}
