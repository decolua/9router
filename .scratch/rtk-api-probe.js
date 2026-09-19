/**
 * Live probe: does tray-style CLI auth GET/PATCH rtkEnabled work?
 * Also dumps raw response so we can see shape mismatches.
 */
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");

const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const DATA = path.join(APPDATA, "9router");
const MACHINE = fs.readFileSync(path.join(DATA, "machine-id"), "utf8").trim();
const SECRET = fs.readFileSync(path.join(DATA, "auth", "cli-secret"), "utf8").trim();
const TOKEN = crypto.createHash("sha256").update(MACHINE + "9r-cli-auth" + SECRET).digest("hex").substring(0, 16);

function req(method, urlPath, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: "127.0.0.1",
      port: 20128,
      path: urlPath,
      method,
      headers: {
        "Content-Type": "application/json",
        "x-9r-cli-token": TOKEN,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, parsed });
      });
    });
    r.on("error", (e) => resolve({ status: 0, error: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const before = await req("GET", "/api/settings");
  console.log("GET status", before.status, "rtkEnabled=", before.parsed?.rtkEnabled);

  // Flip to opposite of current
  const cur = before.parsed?.rtkEnabled !== false;
  const want = !cur;
  const patch = await req("PATCH", "/api/settings", { rtkEnabled: want });
  console.log("PATCH status", patch.status, "rtkEnabled=", patch.parsed?.rtkEnabled, "error=", patch.parsed?.error);

  const after = await req("GET", "/api/settings");
  console.log("GET after status", after.status, "rtkEnabled=", after.parsed?.rtkEnabled);

  // Restore
  await req("PATCH", "/api/settings", { rtkEnabled: cur });

  const ok = after.parsed?.rtkEnabled === want && patch.status < 400;
  console.log(ok ? "GREEN: API toggle works" : "RED: API toggle broken");
  process.exit(ok ? 0 : 1);
})();
