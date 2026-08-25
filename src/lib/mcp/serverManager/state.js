/**
 * Shared connection state for the user-configured MCP server manager.
 *
 * State is kept on `globalThis` so it survives Next.js hot reloads in dev.
 * Also owns the stdio crash cooldown map — rapid respawns after a bad
 * configuration would spam the OS and hide the real error, so we throttle.
 */

const G_KEY = "__9routerMcpServerConnections";

export const STDIO_COOLDOWN_MS = 10_000; // 10s after a crash
export const STDIO_QUICK_FAILURE_MS = 5_000; // <5s runtime = quick failure

/**
 * @returns {{
 *   transports: Map<string, object>,      // `stdio:{serverId}` → entry
 *   sessions: Map<string, object>,        // `session:{sessionId}` → { serverId, transport }
 *   cooldowns: Map<string, number>,       // cooldownKey → expiry timestamp
 *   gatewaySessions: Map<string, object>, // gateway sessionId → { send, ownerId, createdAt }
 *   remoteSessions?: Map<string, string>, // remote serverId → mcp-session-id
 * }}
 */
export function getConnections() {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = {
      transports: new Map(),
      sessions: new Map(),
      cooldowns: new Map(),
      gatewaySessions: new Map(),
    };
  }
  // Backwards compat for state written before gatewaySessions existed.
  if (!globalThis[G_KEY].gatewaySessions) {
    globalThis[G_KEY].gatewaySessions = new Map();
  }
  return globalThis[G_KEY];
}

// ─── Stdio crash cooldowns ─────────────────────────────────────────────────

function createCooldownKey(command, args, env) {
  return `${command}:${(args || []).join(",")}:${JSON.stringify(env || {})}`;
}

export function isInCooldown(command, args, env) {
  const key = createCooldownKey(command, args, env);
  const expiry = getConnections().cooldowns.get(key);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    getConnections().cooldowns.delete(key);
    return false;
  }
  return true;
}

export function setCooldown(command, args, env) {
  const key = createCooldownKey(command, args, env);
  getConnections().cooldowns.set(key, Date.now() + STDIO_COOLDOWN_MS);
  console.log(
    `[mcp-server-manager] Cooldown set for ${command} ${(args || []).join(" ")} (${STDIO_COOLDOWN_MS}ms)`,
  );
}

export function getCooldownRemaining(command, args, env) {
  const key = createCooldownKey(command, args, env);
  const expiry = getConnections().cooldowns.get(key);
  if (!expiry) return 0;
  return Math.max(0, expiry - Date.now());
}
