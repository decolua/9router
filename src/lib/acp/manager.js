// Ported from OmniRoute src/lib/acp/manager.ts.
// ACP (Agent Client Protocol) — Process Spawner & Manager. Spawns CLI agents as
// child processes and manages their lifecycle via stdin/stdout (JSON-RPC style).

import { spawn } from "child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

/**
 * @typedef {Object} AcpSession
 * @property {string} id
 * @property {string} agentId
 * @property {import("child_process").ChildProcess} process
 * @property {boolean} alive
 * @property {string} stdoutBuffer
 * @property {string} stderrBuffer
 * @property {Date} createdAt
 */

const ALLOWED_AGENTS = ["claude", "codex", "gemini", "qwen"];

export class AcpManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  spawn(agentId, binary, args = [], env = {}) {
    if (!ALLOWED_AGENTS.includes(agentId)) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const sessionId = `acp-${agentId}-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
      shell: false,
    });

    const session = {
      id: sessionId,
      agentId,
      process: child,
      alive: true,
      stdoutBuffer: "",
      stderrBuffer: "",
      createdAt: new Date(),
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      session.stdoutBuffer += text;
      this.emit("stdout", { sessionId, data: text });
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      session.stderrBuffer += text;
      this.emit("stderr", { sessionId, data: text });
    });

    child.on("exit", (code, signal) => {
      session.alive = false;
      this.emit("exit", { sessionId, code, signal });
    });

    child.on("error", (err) => {
      session.alive = false;
      this.emit("error", { sessionId, error: err });
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  sendInput(sessionId, input) {
    const session = this.sessions.get(sessionId);
    if (!session?.alive || !session.process.stdin?.writable) return false;

    session.process.stdin.write(input);
    return true;
  }

  async sendPrompt(sessionId, prompt, timeoutMs = 120000) {
    const session = this.sessions.get(sessionId);
    if (!session?.alive) throw new Error(`Session ${sessionId} is not alive`);

    session.stdoutBuffer = "";
    this.sendInput(sessionId, prompt + "\n");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`ACP timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      let idleTimer;

      const onData = ({ sessionId: sid }) => {
        if (sid !== sessionId) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          clearTimeout(timer);
          this.removeListener("stdout", onData);
          this.removeListener("exit", onExit);
          resolve(session.stdoutBuffer);
        }, 2000); // 2s idle = response complete
      };

      const onExit = ({ sessionId: sid }) => {
        if (sid !== sessionId) return;
        clearTimeout(timer);
        clearTimeout(idleTimer);
        this.removeListener("stdout", onData);
        this.removeListener("exit", onExit);
        resolve(session.stdoutBuffer);
      };

      this.on("stdout", onData);
      this.on("exit", onExit);
    });
  }

  kill(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.alive) {
      session.process.kill("SIGTERM");
      setTimeout(() => {
        if (session.alive) {
          session.process.kill("SIGKILL");
        }
      }, 5000);
    }

    this.sessions.delete(sessionId);
    return true;
  }

  getActiveSessions() {
    return Array.from(this.sessions.values()).filter((s) => s.alive);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  killAll() {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}

export const acpManager = new AcpManager();
