// Local-only HTTP/UI fixture. Requires Node >=22.13 and `npm run build` first.
// All provider responses and credentials are synthetic; no external fetch is allowed.
const { mkdtempSync, mkdirSync, existsSync, unlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const http = require("node:http");
const dataDir = mkdtempSync(path.join(tmpdir(), "9router-codex-fixture-"));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "production";
process.env.CODEX_IMAGE_MODEL_ALIASES = '{"gpt-5.5-image":"gpt-5.6-luna-image"}';
mkdirSync(path.join(dataDir, "db"));
const db = new DatabaseSync(path.join(dataDir, "db/data.sqlite"));
db.exec(`CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE providerConnections(id TEXT PRIMARY KEY, provider TEXT NOT NULL, authType TEXT NOT NULL, name TEXT, email TEXT, priority INTEGER, isActive INTEGER DEFAULT 1, data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL);`);
db.prepare("INSERT INTO settings VALUES(1, ?)").run(JSON.stringify({ requireLogin: false, requireApiKey: true, codexAutoPing: { enabled: false, connections: {} } }));
const date = new Date().toISOString();
db.prepare("INSERT INTO providerConnections VALUES(?, 'codex', 'oauth', ?, NULL, 1, 1, ?, ?, ?)")
  .run("fixture-account", "Synthetic Codex account", JSON.stringify({ testStatus: "active", accessToken: "synthetic-token", expiresAt: "2099-01-01T00:00:00Z", providerSpecificData: { chatgptAccountId: "synthetic-account" } }), date, date);
db.prepare("INSERT INTO apiKeys VALUES('fixture-key', 'fixture-key', 'Local fixture', NULL, 1, ?)").run(date);
db.close();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII=";
function sse(event) { return new Response(`data: ${JSON.stringify(event)}\r\n\r\n`, { headers: { "Content-Type": "text/event-stream" } }); }
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  if (url.hostname !== "chatgpt.com") throw new Error(`Fixture blocks external fetch: ${url.hostname}`);
  if (url.pathname.endsWith("/models")) return Response.json({ models: ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.4"].map((id) => ({ id })) });
  if (!url.pathname.endsWith("/responses")) return Response.json({ error: { message: "Unused fixture endpoint" } }, { status: 404 });
  const headers = new Headers(init.headers);
  if (headers.get("version") !== "0.153.4" || !headers.get("user-agent")?.includes("0.153.4")) {
    return Response.json({ error: { message: "This model requires a newer version of Codex." } }, { status: 400 });
  }
  const body = JSON.parse(init.body || "{}");
  if (!body.input?.length) return Response.json({ error: { message: "Missing required input" } }, { status: 400 });
  if (body.model === "gpt-5.4") return Response.json({ error: { message: "The model 'gpt-5.4' does not exist or you do not have access to it.", code: "model_not_found" } }, { status: 404 });
  if (JSON.stringify(body.input).includes("fixture-stream-error")) return sse({ type: "response.failed", response: { error: { message: "This model requires a newer version of Codex.", status_code: 400 } } });
  return sse({ type: "response.completed", response: { status: "completed", output: [{ type: "image_generation_call", result: png }] } });
};
// Create this marker to exercise the dashboard's failed-save state once.
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
  const [req, res] = args;
  const marker = path.join(dataDir, "fail-next-settings-save");
  if (event === "request" && req.method === "PATCH" && req.url === "/api/settings" && existsSync(marker)) {
    unlinkSync(marker);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Synthetic settings failure" }));
    return true;
  }
  return originalEmit.call(this, event, ...args);
};
console.log(`FIXTURE_DATA_DIR=${dataDir}`);
require("../../custom-server.js");
process.argv = [process.argv[0], require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", process.env.FIXTURE_PORT || "20139"];
require("next/dist/bin/next");
