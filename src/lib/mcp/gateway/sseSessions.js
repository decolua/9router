// Per-session registry for SSE transport. Each gateway SSE connection gets
// a sessionId; the message route looks up the send function via that id.

import { v4 as uuidv4 } from "uuid";

const KEY = "__9routerGatewaySse";

function getStore() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = new Map();
  }
  return globalThis[KEY];
}

/**
 * Register an outbound send callback for a new SSE session.
 * @param {(chunk: string) => void} sendFn
 * @returns {string} session id
 */
export function registerSession(sendFn) {
  const sid = uuidv4();
  getStore().set(sid, { send: sendFn, createdAt: Date.now() });
  return sid;
}

/**
 * Unregister an SSE session.
 * @param {string} sid
 */
export function unregisterSession(sid) {
  getStore().delete(sid);
}

/**
 * Look up an SSE session by id.
 * @param {string} sid
 * @returns {{send: (chunk: string) => void, createdAt: number} | null}
 */
export function getSession(sid) {
  return getStore().get(sid) || null;
}
