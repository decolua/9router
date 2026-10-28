/**
 * Session store for the ACP agent: in-memory map + JSON persistence so
 * `session/load` / `session/list` / `session/delete` survive an editor restart.
 *
 * Messages are kept in OpenAI chat format — that is what the gateway speaks,
 * so a reloaded session replays straight into a new prompt turn.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), ".9router");
const STORE_FILE = path.join(DATA_DIR, "acp-sessions.json");
const SECRET_MODE = 0o600;
const MAX_STORED = 100;
const MAX_SESSION_MESSAGES = 400;

const newSessionId = () => `sess_${crypto.randomBytes(12).toString("hex")}`;

function titleFromPrompt(prompt) {
  const text = Array.isArray(prompt)
    ? prompt.map((b) => (b?.type === "text" ? b.text : "")).join(" ")
    : String(prompt || "");
  const line = text.trim().split(/\r?\n/)[0] || "New session";
  return line.length > 60 ? `${line.slice(0,57)}...` : line;
}

class SessionStore {
  constructor({ file = STORE_FILE } = {}) {
    this.file = file;
    this.sessions = new Map();
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const [id, s] of Object.entries(raw?.sessions || {})) this.sessions.set(id, s);
    } catch {
      /* first run / corrupt file: start empty */
    }
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const entries = [...this.sessions.entries()]
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
        .slice(0, MAX_STORED);
      const obj = { sessions: Object.fromEntries(entries) };
      fs.writeFileSync(this.file, `${JSON.stringify(obj)}\n`, { mode: SECRET_MODE });
      try {
        fs.chmodSync(this.file, SECRET_MODE);
      } catch {
        /* Windows */
      }
    } catch {
      /* never break the protocol on persistence */
    }
  }

  create({ cwd, mcpServers = [], additionalDirectories = [] }) {
    const now = Date.now();
    const session = {
      id: newSessionId(),
      cwd: path.resolve(cwd || process.cwd()),
      title: "",
      createdAt: now,
      updatedAt: now,
      model: null,
      tokenSaver: true,
      messages: [],
      mcpServers,
      additionalDirectories,
      usage: null,
    };
    this.sessions.set(session.id, session);
    this.persist();
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  /** Restore a session by id even if the process restarted (memory miss). */
  ensure(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    this._load();
    return this.sessions.get(id) || null;
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((s) => ({
        sessionId: s.id,
        title: s.title || "Untitled",
        cwd: s.cwd,
        updatedAt: new Date(s.updatedAt || s.createdAt).toISOString(),
      }));
  }

  delete(id) {
    const had = this.sessions.delete(id);
    if (had) this.persist();
    return had;
  }

  touch(session, { title } = {}) {
    session.updatedAt = Date.now();
    if (title && !session.title) session.title = title;
    if (session.messages.length > MAX_SESSION_MESSAGES) {
      // Keep the system message (if any) and the tail; tool pairs are dropped
      // as a block so a lone `tool` message is never left dangling.
      const head = session.messages[0]?.role === "system" ? session.messages.slice(0, 1) : [];
      const tail = session.messages.slice(-MAX_SESSION_MESSAGES + head.length);
      while (tail.length && tail[0].role === "tool") tail.shift();
      session.messages = [...head, ...tail];
    }
    this.persist();
  }
}

module.exports = { SessionStore, STORE_FILE, titleFromPrompt, newSessionId };
