// Per-session registry for SSE transport. Each gateway SSE connection gets
// a sessionId; the message route looks up the send function via that id.

import crypto from "node:crypto";

const KEY = "__9routerGatewaySse";
function getStore() {
  if (!globalThis[KEY]) globalThis[KEY] = new Map();
  return globalThis[KEY];
}

export function registerSession(sendFn) {
  const sid = crypto.randomUUID();
  getStore().set(sid, { send: sendFn, createdAt: Date.now() });
  return sid;
}

export function unregisterSession(sid) {
  getStore().delete(sid);
}

export function getSession(sid) {
  return getStore().get(sid) || null;
}
