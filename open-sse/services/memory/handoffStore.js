/**
 * Cross-Session Handoff Store (Memory Optimization)
 *
 * Inspired by ai-memory's Session Handoff mechanism:
 * Allows persisting and recovering structured handoff packets across CLI agent
 * switches (e.g. Claude Code → Codex → Cline) in the same project directory.
 */

// In-memory runtime handoff registry keyed by project key or session key
const runtimeHandoffStore = new Map();

/**
 * Record a session handoff summary
 * @param {string} projectKey - Project directory or identifier
 * @param {Object} handoffData - { summary, activeTasks, nextSteps, agent, timestamp }
 */
export function recordHandoff(projectKey, handoffData) {
  if (!projectKey || !handoffData) return;
  runtimeHandoffStore.set(projectKey, {
    ...handoffData,
    timestamp: Date.now(),
  });

  // Limit store size to 500 entries
  if (runtimeHandoffStore.size > 500) {
    const oldestKey = runtimeHandoffStore.keys().next().value;
    runtimeHandoffStore.delete(oldestKey);
  }
}

/**
 * Get latest handoff for a project
 * @param {string} projectKey
 * @returns {Object|null}
 */
export function getHandoff(projectKey) {
  if (!projectKey) return null;
  return runtimeHandoffStore.get(projectKey) || null;
}

/**
 * Clear handoff for a project after delivery
 * @param {string} projectKey
 */
export function consumeHandoff(projectKey) {
  if (!projectKey) return;
  runtimeHandoffStore.delete(projectKey);
}

/**
 * Inject pending handoff into the initial user prompt if available
 * @param {Object} body - Request body
 * @param {Object} options
 * @param {boolean} options.enabled - Whether handoff injection is enabled
 * @param {string} options.projectKey - Project key identifier
 * @returns {{ body: Object, injected: boolean }}
 */
export function injectPendingHandoff(body, options = {}) {
  const { enabled = false, projectKey } = options;

  if (!enabled || !projectKey || !body || typeof body !== "object") {
    return { body, injected: false };
  }

  const handoff = getHandoff(projectKey);
  if (!handoff || !handoff.summary) {
    return { body, injected: false };
  }

  const items = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : null;
  if (!items || items.length === 0) {
    return { body, injected: false };
  }

  // Find the first user message to prepend the handoff context
  const firstUserMsg = items.find((m) => m?.role === "user");
  if (firstUserMsg && typeof firstUserMsg.content === "string") {
    const handoffNotice = [
      `[Previous Agent Handoff Context (via 9router)]:`,
      handoff.summary,
      `---\n`,
    ].join("\n");

    firstUserMsg.content = `${handoffNotice}${firstUserMsg.content}`;
    consumeHandoff(projectKey);
    return { body, injected: true };
  }

  return { body, injected: false };
}
