// Ported from OmniRoute src/lib/acp/registry.ts.
// ACP (Agent Client Protocol) — CLI Agent Registry. Detects installed CLI agents
// (codex, claude, goose, gemini, etc.) by running a sanitized version command.
// The tokenizer is security-critical: it rejects shell metacharacters so a
// malicious/custom versionCommand cannot inject shell commands.

import { execFileSync } from "child_process";
import path from "path";

/**
 * @typedef {Object} CliAgentInfo
 * @property {string} id
 * @property {string} name
 * @property {string} binary
 * @property {string} versionCommand
 * @property {string|null} version
 * @property {boolean} installed
 * @property {string} providerAlias
 * @property {string[]} spawnArgs
 * @property {"stdio"|"http"} protocol
 * @property {boolean} [isCustom]
 */

/**
 * @typedef {Object} CustomAgentDef
 * @property {string} id
 * @property {string} name
 * @property {string} binary
 * @property {string} versionCommand
 * @property {string} providerAlias
 * @property {string[]} spawnArgs
 * @property {"stdio"|"http"} protocol
 */

const AGENT_DEFINITIONS = [
  { id: "codex", name: "OpenAI Codex CLI", binary: "codex", versionCommand: "codex --version", providerAlias: "codex", spawnArgs: ["--quiet"], protocol: "stdio" },
  { id: "claude", name: "Claude Code CLI", binary: "claude", versionCommand: "claude --version", providerAlias: "claude", spawnArgs: ["--print", "--output-format", "json"], protocol: "stdio" },
  { id: "goose", name: "Goose CLI", binary: "goose", versionCommand: "goose --version", providerAlias: "goose", spawnArgs: [], protocol: "stdio" },
  { id: "gemini-cli", name: "Gemini CLI", binary: "gemini", versionCommand: "gemini --version", providerAlias: "gemini-cli", spawnArgs: [], protocol: "stdio" },
  { id: "openclaw", name: "OpenClaw", binary: "openclaw", versionCommand: "openclaw --version", providerAlias: "openclaw", spawnArgs: [], protocol: "stdio" },
  { id: "aider", name: "Aider", binary: "aider", versionCommand: "aider --version", providerAlias: "aider", spawnArgs: ["--no-auto-commits"], protocol: "stdio" },
  { id: "opencode", name: "OpenCode", binary: "opencode", versionCommand: "opencode --version", providerAlias: "opencode", spawnArgs: [], protocol: "stdio" },
  { id: "cline", name: "Cline", binary: "cline", versionCommand: "cline --version", providerAlias: "cline", spawnArgs: [], protocol: "stdio" },
  { id: "qwen-code", name: "Qwen Code", binary: "qwen", versionCommand: "qwen --version", providerAlias: "qwen", spawnArgs: [], protocol: "stdio" },
  { id: "forge", name: "ForgeCode", binary: "forge", versionCommand: "forge --version", providerAlias: "forge", spawnArgs: [], protocol: "stdio" },
  { id: "amazon-q", name: "Amazon Q Developer", binary: "q", versionCommand: "q --version", providerAlias: "amazon-q", spawnArgs: [], protocol: "stdio" },
  { id: "interpreter", name: "Open Interpreter", binary: "interpreter", versionCommand: "interpreter --version", providerAlias: "interpreter", spawnArgs: [], protocol: "stdio" },
  { id: "cursor-cli", name: "Cursor CLI", binary: "cursor", versionCommand: "cursor --version", providerAlias: "cursor", spawnArgs: [], protocol: "stdio" },
  { id: "warp", name: "Warp AI", binary: "warp", versionCommand: "warp --version", providerAlias: "warp", spawnArgs: [], protocol: "stdio" },
];

// Detection cache (60 seconds).
let _cachedAgents = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

let _customAgentDefs = [];

const DISALLOWED_VERSION_COMMAND_CHARS = /[;&|<>`$\r\n]/;

export function setCustomAgents(agents) {
  _customAgentDefs = agents || [];
  _cachedAgents = null; // invalidate cache
}

export function getCustomAgentDefs() {
  return _customAgentDefs;
}

// Security-critical tokenizer: splits a version command into [command, ...args]
// while rejecting shell metacharacters (; & | < > ` $ and newlines). Returns null
// for empty/disallowed commands or unterminated quotes.
function tokenizeVersionCommand(command) {
  if (!command || DISALLOWED_VERSION_COMMAND_CHARS.test(command)) {
    return null;
  }

  const tokens = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (char === "\\") {
      const next = command[index + 1];
      if (next) {
        current += next;
        index += 1;
        continue;
      }
    }

    current += char;
  }

  if (quote) {
    return null; // unterminated quote
  }

  if (current) {
    tokens.push(current);
  }

  return tokens.length > 0 ? tokens : null;
}

function normalizeCommandToken(command) {
  return path.normalize(command).replace(/\\/g, "/").toLowerCase();
}

export function resolveVersionProbe(binary, versionCommand, requireBinaryMatch = false) {
  const tokens = tokenizeVersionCommand(versionCommand);
  if (!tokens) {
    return null;
  }

  const [command, ...args] = tokens;
  if (!command) {
    return null;
  }

  if (requireBinaryMatch) {
    const normalizedCommand = normalizeCommandToken(command);
    const allowed = new Set([
      normalizeCommandToken(binary),
      normalizeCommandToken(path.basename(binary)),
    ]);
    if (!allowed.has(normalizedCommand)) {
      return null;
    }
  }

  return { command, args };
}

export function shouldUseShellForVersionProbe(command, platform = process.platform) {
  if (platform !== "win32") return false;

  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.endsWith(".cmd") || normalized.endsWith(".bat") || path.extname(normalized) === ""
  );
}

function detectAgent(def, isCustom = false) {
  let version = null;
  let installed = false;

  try {
    const probe = resolveVersionProbe(def.binary, def.versionCommand, isCustom);
    if (!probe) {
      return { ...def, version, installed, isCustom };
    }

    const output = execFileSync(probe.command, probe.args, {
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(shouldUseShellForVersionProbe(probe.command) ? { shell: true } : {}),
    }).trim();

    const versionMatch = output.match(/(\d+\.\d+\.\d+(?:-\w+)?)/);
    version = versionMatch ? versionMatch[1] : output.split("\n")[0];
    installed = true;
  } catch {
    // Not installed or not runnable
  }

  return { ...def, version, installed, isCustom };
}

export function detectInstalledAgents() {
  const now = Date.now();
  if (_cachedAgents && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedAgents;
  }

  const allDefs = [
    ...AGENT_DEFINITIONS.map((d) => ({ ...d, _custom: false })),
    ..._customAgentDefs.map((d) => ({ ...d, _custom: true })),
  ];

  _cachedAgents = allDefs.map((def) => {
    const { _custom, ...rest } = def;
    return detectAgent(rest, _custom);
  });
  _cacheTimestamp = now;

  return _cachedAgents;
}

export function refreshAgentCache() {
  _cachedAgents = null;
  return detectInstalledAgents();
}

export function getAgentById(id) {
  return detectInstalledAgents().find((a) => a.id === id);
}

export function getAvailableAgents() {
  return detectInstalledAgents().filter((a) => a.installed);
}
