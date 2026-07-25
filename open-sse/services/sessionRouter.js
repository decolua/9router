const sessionState = new Map();
const SESSION_TTL = 30 * 60 * 1000;
const STICKY_CAP = 50;

setInterval(cleanupStale, 60000);

function cleanupStale() {
  const now = Date.now();
  for (const [sid, state] of sessionState) {
    if (now - state.lastSeen > SESSION_TTL) {
      sessionState.delete(sid);
    }
  }
}

export function getSessionId(request) {
  if (!request) return null;

  const headers = request.headers || {};
  const body = request.body || {};

  let sid = headers['x-session-id'] || headers['x-conversation-id'];
  if (sid) return sanitizeId(sid);

  const url = request.url ? new URL(request.url, 'http://localhost') : null;
  sid = url?.searchParams?.get('session_id');
  if (sid) return sanitizeId(sid);

  if (Array.isArray(body.messages)) {
    const firstContent = body.messages[0]?.content;
    if (typeof firstContent === 'string' && firstContent.length > 5) {
      sid = 'fp_' + simpleHash(firstContent + (body.messages.length || 0));
      return sid;
    }
  }

  const agent = headers['user-agent'] || '';
  const ip = headers['x-forwarded-for'] || headers['x-real-ip'] || '';
  if (agent || ip) {
    sid = 'fp_' + simpleHash(agent + ip + (body.model || ''));
    return sid;
  }

  return null;
}

function sanitizeId(id) {
  if (typeof id !== 'string') return null;
  if (id.length > 128) id = id.slice(0, 128);
  if (!/^[a-zA-Z0-9_\-.:@]+$/.test(id)) {
    id = id.replace(/[^a-zA-Z0-9_\-.:@]/g, '_');
  }
  return id.slice(0, 64);
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h = h & h;
  }
  return Math.abs(h).toString(36);
}

export function getOrInitSession(sessionId, task, models) {
  if (!sessionId) return null;

  const now = Date.now();
  let state = sessionState.get(sessionId);

  if (!state) {
    const preferredTask = task || 'chat';
    const bestModel = pickBestModelForTask(preferredTask, models);
    state = {
      sessionId,
      createdAt: now,
      lastSeen: now,
      requestCount: 0,
      currentTask: preferredTask,
      stickyModel: bestModel,
      modelRotationCount: 0,
      taskHistory: [preferredTask],
      consecutiveErrors: 0,
    };
    sessionState.set(sessionId, state);
  }

  state.lastSeen = now;
  state.requestCount++;

  if (task && task !== state.currentTask) {
    state.taskHistory.push(task);
    if (state.taskHistory.length > 10) state.taskHistory.shift();

    const dominantTask = findDominantTask(state.taskHistory);
    if (dominantTask !== state.currentTask) {
      state.currentTask = dominantTask;
      state.stickyModel = pickBestModelForTask(dominantTask, models);
      state.modelRotationCount = 0;
    }
  }

  if (state.requestCount > STICKY_CAP) {
    state.requestCount = 0;
    shiftTaskHistory(state);
  }

  return state;
}

function pickBestModelForTask(task, models) {
  if (!Array.isArray(models) || models.length === 0) return null;

  const preferredCaps = taskToCapability(task);

  const scored = models.map(m => {
    const modelStr = typeof m === 'string' ? m : (m.model || m);
    let score = 0;

    if (preferredCaps.code && /coder|code|deepseek/i.test(modelStr)) score += 3;
    if (preferredCaps.reasoning && /reason|deepseek|kimi|glm|qwen/i.test(modelStr)) score += 2;
    if (preferredCaps.vision && /vision|vl|gemini|minimax-m3/i.test(modelStr)) score += 3;
    if (preferredCaps.chat && !/coder|reason|vision|vl\b/i.test(modelStr)) score += 1;

    return { model: m, score, str: modelStr };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.model || models[0];
}

function taskToCapability(task) {
  switch (task) {
    case 'code': case 'refactoring': return { code: true };
    case 'reasoning': case 'planning': return { reasoning: true };
    case 'vision': return { vision: true };
    default: return { chat: true };
  }
}

function findDominantTask(history) {
  const counts = {};
  for (const t of history) counts[t] = (counts[t] || 0) + 1;

  let best = 'chat';
  let bestCount = 0;
  for (const [t, c] of Object.entries(counts)) {
    if (c > bestCount) { bestCount = c; best = t; }
  }
  return best;
}

function shiftTaskHistory(state) {
  const recent = state.taskHistory.slice(-5);
  const deduped = [...new Set(recent)];
  state.taskHistory = deduped.length > 0 ? deduped : ['chat'];
}

export function recordError(sessionId) {
  if (!sessionId) return;
  const state = sessionState.get(sessionId);
  if (state) {
    state.consecutiveErrors++;
    if (state.consecutiveErrors >= 3) {
      state.stickyModel = null;
      state.consecutiveErrors = 0;
    }
  }
}

export function recordSuccess(sessionId) {
  if (!sessionId) return;
  const state = sessionState.get(sessionId);
  if (state) {
    state.consecutiveErrors = 0;
  }
}

export function resetSession(sessionId) {
  if (sessionId) sessionState.delete(sessionId);
}

export function getSessionStats() {
  const stats = { active: sessionState.size };
  let totalReqs = 0;
  for (const [, s] of sessionState) totalReqs += s.requestCount;
  stats.totalRequests = totalReqs;
  return stats;
}
