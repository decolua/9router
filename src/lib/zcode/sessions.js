import { makeKv } from "../db/helpers/kvStore.js";

const TTL_MS = 10 * 60 * 1000;
const SESSIONS_KEY = Symbol.for("9router.zcode.oauthSessions");
const kv = makeKv("zaiOAuthSessions");

function getSessionMap() {
  if (!globalThis[SESSIONS_KEY]) {
    globalThis[SESSIONS_KEY] = new Map();
  }
  return globalThis[SESSIONS_KEY];
}

async function pruneKv(now = Date.now()) {
  try {
    const all = await kv.getAll();
    for (const [id, session] of Object.entries(all)) {
      if (!session?.expiresAt || session.expiresAt <= now) {
        await kv.remove(id);
        getSessionMap().delete(id);
      }
    }
  } catch {
    // ignore kv prune errors
  }
}

function pruneMemory(now = Date.now()) {
  const sessions = getSessionMap();
  for (const [id, session] of sessions) {
    if (!session?.expiresAt || session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

export async function createZaiSession({ flowId, pollToken }) {
  const now = Date.now();
  pruneMemory(now);
  await pruneKv(now);

  const session = {
    flowId,
    pollToken,
    expiresAt: now + TTL_MS,
  };

  getSessionMap().set(flowId, session);
  await kv.set(flowId, session);
  return flowId;
}

export async function getZaiSession(sessionId) {
  const now = Date.now();
  pruneMemory(now);

  let session = getSessionMap().get(sessionId);
  if (!session) {
    session = await kv.get(sessionId);
    if (session) {
      getSessionMap().set(sessionId, session);
    }
  }

  if (!session || session.expiresAt <= now) {
    getSessionMap().delete(sessionId);
    await kv.remove(sessionId).catch(() => {});
    return null;
  }

  return session;
}

export async function deleteZaiSession(sessionId) {
  getSessionMap().delete(sessionId);
  await kv.remove(sessionId).catch(() => {});
}