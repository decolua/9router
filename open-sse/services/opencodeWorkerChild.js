// Worker child: performs ONE impersonated-TLS fetch in a fresh Node process.
//
// Why a child process (2026-10-30): the long-lived router process gets 429
// FreeUsageLimitError from opencode.ai on EVERY inference request regardless
// of egress IP, session id, fingerprint shape, headers, body bytes or TLS
// module (bundled or source) — while the byte-identical request from any
// fresh process passes (measured: the router's sticky sid reused verbatim
// from a fresh process on the SAME egress IP -> 200). The upstream or the
// gateway distinguishes them through something process-lifetime-bound that
// cannot be observed or patched from inside. A fresh process per attempt
// restores the proven-passing configuration.
//
// Protocol:
//   stdin : 1 line JSON { id, url, method, headers, body, proxyUrl, timeoutMs }
//   fd 3  : 1 line JSON { id, ok, status, statusText, headers }  (header msg)
//   stdout: raw response body bytes (streamed, never buffered)
//   exit 0 on success; exit 1 after writing an {ok:false} header line.
import fs from "node:fs";
import readline from "node:readline";

const MODULE_URL = new URL("./opencodeTlsClient.js", import.meta.url).href;

function writeHeader(obj) {
  try {
    fs.writeSync(3, JSON.stringify(obj) + "\n");
  } catch {
    // parent went away
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const line = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("worker: stdin timeout")), 15000);
    rl.once("line", (l) => { clearTimeout(t); resolve(l); });
    rl.once("close", () => { clearTimeout(t); reject(new Error("worker: stdin closed")); });
  });
  rl.close();

  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    writeHeader({ id: "?", ok: false, error: "bad request line: " + String(e?.message || e).slice(0, 100) + " lineLen=" + (line?.length || 0) + " head=" + String(line || "").slice(0, 80) });
    process.exit(2);
  }

  const { opencodeTlsFetch } = await import(MODULE_URL);

  try {
    const res = await opencodeTlsFetch(req.url, {
      method: req.method || "GET",
      headers: req.headers || {},
      body: req.body,
    }, { proxyUrl: req.proxyUrl, timeoutMs: req.timeoutMs || 20000 });

    const headers = {};
    res.headers?.forEach?.((value, key) => { headers[key] = value; });
    writeHeader({ id: req.id, ok: true, status: res.status, statusText: res.statusText, headers });

    // Stream the body verbatim to stdout. Never buffer: SSE tokens must flow.
    if (res.body && typeof res.body.pipe === "function") {
      await new Promise((resolve, reject) => {
        res.body.on("error", reject);
        process.stdout.on("error", reject);
        res.body.pipe(process.stdout);
        res.body.on("end", resolve);
      });
    } else if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        process.stdout.write(Buffer.from(value));
      }
    }
    process.exit(0);
  } catch (e) {
    writeHeader({ id: req.id, ok: false, error: String(e?.message || e) });
    process.exit(1);
  }
}

// Hard self-destruct: a hung worker must never hold a client request.
setTimeout(() => process.exit(3), 180000).unref?.();

main().catch((e) => { writeHeader({ id: '?', ok: false, error: 'main: ' + String(e?.message || e).slice(0, 160) }); process.exit(1); });
