"use strict";

// Used only for bounded management JSON, never model generation streams.
function relayBufferedResponse(upstream, res, { status, headers, transform, onResponse, dumper, maxBytes = 2 * 1024 * 1024, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let timer;
    function finish() { clearTimeout(timer); resolve(); }
    function fail() {
      if (settled) return;
      settled = true;
      try {
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        if (!res.writableEnded) res.end(JSON.stringify({ error: { type: "management_response_error", message: "Unable to process the management response." } }));
      } catch { /* Client may already have disconnected. */ }
      try { upstream.destroy(); } catch {}
      finish();
    }
    timer = setTimeout(fail, timeoutMs);
    upstream.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) { fail(); upstream.destroy(); return; }
      chunks.push(buffer);
    });
    upstream.once("error", fail);
    upstream.once("aborted", fail);
    upstream.once("close", fail);
    upstream.once("end", () => {
      if (settled) return;
      const raw = Buffer.concat(chunks);
      try {
        if (onResponse) { try { onResponse(raw, headers, status); } catch { /* Observer only. */ } }
        const result = transform(raw, headers, status);
        if (!result || !Buffer.isBuffer(result.body) || !result.headers) return fail();
        res.writeHead(status, result.headers);
        if (dumper) { dumper.writeHeader(status, result.headers); dumper.writeChunk(result.body); dumper.end(); }
        res.end(result.body);
        settled = true;
        finish();
      } catch { fail(); }
    });
  });
}

module.exports = { relayBufferedResponse };
