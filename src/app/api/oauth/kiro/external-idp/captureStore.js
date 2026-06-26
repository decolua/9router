const globalKey = Symbol.for("9router.kiro.hostedSso.sessions");

function getStore() {
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = new Map();
  }
  return globalThis[globalKey];
}

export function listActiveCaptures() {
  return getStore();
}

export function setActiveCapture(sessionId, session) {
  return getStore().set(sessionId, session);
}

export function getActiveCapture(sessionId) {
  return getStore().get(sessionId);
}

export function dropActiveCapture(sessionId) {
  return getStore().delete(sessionId);
}
