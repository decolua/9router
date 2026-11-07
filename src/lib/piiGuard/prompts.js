// Masked prompt store: the new messages of each request, linked to its request and session, searchable.
// Detected values are masked (library maskText) and the result is rescanned; a record that still shows a finding
// is dropped. Undetected text (names, custom secrets) stays readable: this is a partially masked store.
// Lives in ~/.cache, which vps-backup skips; the directory is 0700 and the files 0600.
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PROMPT_CAP = 1024 * 1024, TOOL_CAP = 128 * 1024, REQUEST_CAP = 4 * 1024 * 1024;
// Queue bound is bytes; the message count only stops pathological bodies of tiny strings.
const TTL_MS = 14 * 864e5, QUEUE_MAX = 5000, QUEUE_BYTES = 64 * 1024 * 1024, SEEN_MAX = 200_000;
let sweepTimer = null, db = null, dbFile = null, failed = false, queue = [], queued = 0, draining = false, lastSweep = 0;
export const stats = { stored: 0, dropped: 0, unsafe: 0, errors: 0 };
// Per-session message digests already stored, so a resent conversation stores only what is new.
// ponytail: in memory only; after a restart the first request of a running session stores its history again
// (up to REQUEST_CAP). Seed from the DB if that duplication shows up in disk use.
const seen = new Map();

// Next to a custom events file (tests, other installs); otherwise in ~/.cache, outside backups.
export function promptsFile() {
  const p = process.env.PII_GUARD_PROMPTS;
  if (p && p !== "off") return p;
  return process.env.PII_GUARD_EVENTS ? join(dirname(process.env.PII_GUARD_EVENTS), "prompts.db") : join(homedir(), ".cache/pii-guard/prompts.db");
}

function open(file = promptsFile()) {
  if (db && dbFile !== file) { try { db.close(); } catch {} db = null; failed = false; }
  if (db || failed) return db;
  try {
    dbFile = file;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    chmodSync(dirname(file), 0o700);
    // Loaded lazily so the module stays importable where node:sqlite is missing.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    db = new DatabaseSync(file);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=0;
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, request_id TEXT NOT NULL, session_id TEXT,
        model TEXT, client TEXT, role TEXT, kind TEXT, path TEXT, text TEXT NOT NULL, cut INTEGER NOT NULL DEFAULT 0, hashes TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS messages_ts ON messages(ts);
      CREATE INDEX IF NOT EXISTS messages_request ON messages(request_id);
      CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, ts);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='unicode61');
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text); END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text); END;`);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) try { chmodSync(f, 0o600); } catch {}
    // Retention runs on a timer too, so it never depends on traffic.
    if (!sweepTimer) { sweepTimer = setInterval(() => sweep(), 36e5); sweepTimer.unref(); }
  } catch { failed = true; db = null; return null; }
  sweep();
  return db;
}

const digest = (s) => createHash("sha256").update(s).digest("base64url").slice(0, 22);
// Text nodes worth keeping: role/kind come from the scanner source ("user/text", "user/tool_result", ...).
function cap(text, kind) {
  const limit = kind === "tool_result" || kind === "function_call_output" ? TOOL_CAP : PROMPT_CAP;
  return text.length > limit ? [text.slice(0, limit), 1] : [text, 0];
}

const str = (v) => (typeof v === "string" ? v : "");
// Roles come from the client; only known names are stored, so a role can never carry a value.
const ROLES = new Set(["system", "developer", "user", "assistant", "tool", "function", "model"]);
const json = (v) => { try { return v && typeof v === "object" ? JSON.stringify(v).slice(0, TOOL_CAP + 1) : str(v); } catch { return ""; } };
function parts(content, role, path, out, kind = "text") {
  if (typeof content === "string") return void out.push({ text: content, role, kind, path });
  if (!Array.isArray(content)) return;
  content.forEach((b, j) => {
    const at = `${path}[${j}]`;
    if (typeof b === "string") return void out.push({ text: b, role, kind, path: at });
    if (!b || typeof b !== "object") return;
    // Thinking, images and files are skipped: signed, binary, or scanned elsewhere.
    if (b.type === "tool_result") return parts(b.content, role, `${at}.content`, out, "tool_result");
    if (b.type === "tool_use") return void out.push({ text: `${str(b.name)} ${json(b.input)}`, role, kind: "tool_use", path: at });
    if (typeof b.text === "string" && b.type !== "thinking") out.push({ text: b.text, role, kind, path: `${at}.text` });
  });
}
/** References to the request's text, taken before redaction rewrites the body. Strings are not copied. */
export function collect(body) {
  const out = [];
  if (!body || typeof body !== "object") return out;
  // Paths must equal scanBody's, so request-scan findings line up: root keys outside its PATH_KEYS are "[field:N]".
  const keys = Object.keys(body), field = (k) => `[field:${keys.indexOf(k)}]`;
  if (body.system) parts(body.system, "system", field("system"), out);
  if (typeof body.instructions === "string") out.push({ text: body.instructions, role: "system", kind: "text", path: field("instructions") });
  if (typeof body.input === "string") out.push({ text: body.input, role: "user", kind: "text", path: "input" });
  const list = Array.isArray(body.messages) ? ["messages", body.messages] : Array.isArray(body.input) ? ["input", body.input] : null;
  if (!list) return out;
  list[1].forEach((m, i) => {
    if (!m || typeof m !== "object") return;
    const at = `${list[0]}[${i}]`, role = ROLES.has(m.role) ? m.role : m.role === undefined ? "tool" : "other";
    if (m.type === "function_call") return out.push({ text: `${str(m.name)} ${str(m.arguments)}`, role: "assistant", kind: "tool_use", path: at });
    if (m.type === "function_call_output") return out.push({ text: json(m.output), role: "tool", kind: "tool_result", path: at });
    parts(m.content, role, `${at}.content`, out, role === "tool" ? "tool_result" : "text");
    if (Array.isArray(m.tool_calls)) m.tool_calls.forEach((c, k) => out.push({ text: `${str(c?.function?.name)} ${str(c?.function?.arguments)}`, role, kind: "tool_use", path: `${at}.tool_calls[${k}]` }));
  });
  return out;
}

/** Picks the strings to store: every string not stored before in this session. Without a session: the latest
 *  string and any string with a finding.
 *  `nodes`: [{ text, role, kind, path, findings }] in request order; texts are originals (before redaction). */
export function pick(nodes, sessionId) {
  const known = sessionId ? seen.get(sessionId) : null;
  const out = [];
  let bytes = 0;
  nodes.forEach((n, i) => {
    if (!n.text || n.text.length < 2 || bytes >= REQUEST_CAP) return;
    const d = digest(`${n.role}\0${n.kind}\0${n.text}`);
    // No session: nothing to dedupe against, so keep only the latest message and messages with findings.
    if (sessionId ? known?.has(d) : !n.findings.length && i !== nodes.length - 1) return;
    out.push({ ...n, digest: d });
    bytes += Math.min(n.text.length, PROMPT_CAP);
  });
  return out;
}
function remember(sessionId, digests) {
  if (!sessionId) return;
  let set = seen.get(sessionId);
  if (!set) { set = new Set(); seen.set(sessionId, set); }
  seen.delete(sessionId); seen.set(sessionId, set); // most recent last
  for (const d of digests) set.add(d);
  let total = 0;
  for (const s of seen.values()) total += s.size;
  for (const [k, s] of seen) { if (total <= SEEN_MAX) break; total -= s.size; seen.delete(k); }
}

/** Queues masked records; never blocks the request. Masking and the rescan happen here (sync, small);
 *  the SQLite write runs after the response starts. Full queue: the record is dropped and counted. */
export function capture(meta, library, detector) {
  if (!meta.nodes.length || typeof library?.maskText !== "function") return;
  // Digests, masking and the rescan run after the request is forwarded.
  const file = promptsFile(); // resolved now; the write runs later
  setImmediate(() => { try { store({ ...meta, file }, library, detector); } catch { stats.errors++; } });
}
function store({ nodes, bodyFindings = [], requestId, sessionId, model, client, file }, library, detector) {
  for (const n of nodes) {
    // The request scan used context (sibling keys like "phone"); a rescan of the bare string may miss those.
    // Same path: reuse its spans. Inside the node but unmatched by hash: unsafe, so the node is not stored.
    const own = detector.scan(n.text), inside = bodyFindings.filter((f) => f.path === n.path || f.path.startsWith(`${n.path}.`) || f.path.startsWith(`${n.path}[`));
    const exact = inside.filter((f) => f.path === n.path && f.end <= n.text.length && !own.some((o) => o.start === f.start && o.end === f.end));
    n.findings = [...own, ...exact];
    // Every request-scan hit inside the node needs its own masked span: compare counts per hash.
    const need = new Map(), have = new Map();
    for (const f of inside) need.set(f.hash, (need.get(f.hash) || 0) + 1);
    for (const f of n.findings) have.set(f.hash, (have.get(f.hash) || 0) + 1);
    n.unsafe = [...need].some(([h, c]) => (have.get(h) || 0) < c);
  }
  const chosen = pick(nodes, sessionId);
  remember(sessionId, chosen.map((n) => n.digest));
  const ts = Date.now();
  for (const n of chosen) {
    if (n.unsafe) { stats.unsafe++; continue; }
    let masked;
    try {
      const [text, cut] = cap(library.maskText(n.text, n.findings), n.kind);
      // Fail closed: anything still detected after masking means a span was missed.
      if (detector.scan(text).length) { stats.unsafe++; continue; }
      masked = { file, ts, requestId, sessionId: sessionId || null, model: model || null, client: client || null, role: n.role, kind: n.kind, path: n.path, text, cut, hashes: [...new Set(n.findings.map((f) => f.hash))].join(" ") };
    } catch { stats.errors++; continue; }
    if (queue.length >= QUEUE_MAX || queued + masked.text.length > QUEUE_BYTES) { stats.dropped++; continue; }
    queue.push(masked); queued += masked.text.length;
  }
  if (!draining && queue.length) { draining = true; setImmediate(drain); }
}
function drain() {
  const all = queue; queue = []; queued = 0; draining = false;
  for (const file of new Set(all.map((r) => r.file))) write(file, all.filter((r) => r.file === file));
  if (Date.now() - lastSweep > 36e5) sweep();
}
function write(file, rows) {
  const d = open(file);
  if (!d) { stats.dropped += rows.length; return; }
  try {
    const ins = d.prepare("INSERT INTO messages (ts, request_id, session_id, model, client, role, kind, path, text, cut, hashes) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    d.exec("BEGIN");
    for (const r of rows) ins.run(r.ts, r.requestId, r.sessionId, r.model, r.client, r.role, r.kind, r.path, r.text, r.cut, r.hashes);
    d.exec("COMMIT");
    stats.stored += rows.length;
  } catch { try { d.exec("ROLLBACK"); } catch {} stats.errors++; }
}
export function sweep(now = Date.now()) {
  lastSweep = now;
  const d = db;
  if (!d) return 0;
  try { return Number(d.prepare("DELETE FROM messages WHERE ts < ?").run(now - TTL_MS).changes); } catch { stats.errors++; return 0; }
}
/** Test helper: write the queue now. */
export function flush() { if (queue.length) drain(); }

// Words and word starts: "repeat this" matches both words in order; quotes stop FTS syntax injection.
function ftsQuery(q) {
  const words = q.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) || [];
  return words.slice(0, 12).map((w, i, a) => `"${w}"${i === a.length - 1 ? "*" : ""}`).join(" ");
}
const COLS = "m.id, m.ts, m.request_id AS requestId, m.session_id AS sessionId, m.model, m.client, m.role, m.kind, m.path, m.cut, m.hashes";
/** Search, newest first, 50 per page. Snippets only; full text comes from `message(id)`. */
export function search({ q = "", sessionId = "", requestId = "", hash = "", from = 0, to = Date.now(), before = Infinity, limit = 50 } = {}) {
  const d = open();
  if (!d) return { rows: [], next: null, unavailable: true };
  const where = ["m.ts >= ?", "m.ts <= ?"], args = [Math.max(from, Date.now() - TTL_MS), to];
  if (Number.isFinite(before)) { where.push("m.id < ?"); args.push(before); }
  if (sessionId) { where.push("m.session_id = ?"); args.push(sessionId); }
  if (requestId) { where.push("m.request_id = ?"); args.push(requestId); }
  if (hash) { where.push("(' ' || m.hashes || ' ') LIKE ?"); args.push(`% ${hash} %`); }
  const fts = ftsQuery(q);
  if (q && !fts) return { rows: [], next: null };
  const sql = fts
    ? `SELECT ${COLS}, snippet(messages_fts, 0, '\u0001', '\u0002', '…', 24) AS snip FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? AND ${where.join(" AND ")} ORDER BY m.id DESC LIMIT ?`
    : `SELECT ${COLS}, substr(m.text, 1, 240) AS snip FROM messages m WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT ?`;
  const n = Math.min(Math.max(1, limit), 100);
  const rows = d.prepare(sql).all(...(fts ? [fts] : []), ...args, n + 1);
  const page = rows.slice(0, n);
  return { rows: page, next: rows.length > n ? page.at(-1).id : null };
}
export function message(id) {
  const d = open();
  if (!d) return null;
  return d.prepare(`SELECT ${COLS}, m.text FROM messages m WHERE m.id = ? AND m.ts >= ?`).get(id, Date.now() - TTL_MS) || null;
}
/** Test helper. */
export function _reset() { clearInterval(sweepTimer); sweepTimer = null; try { db?.close(); } catch {} db = null; failed = false; queue = []; queued = 0; draining = false; seen.clear(); Object.assign(stats, { stored: 0, dropped: 0, unsafe: 0, errors: 0 }); }
