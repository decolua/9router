const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function hasForbiddenKey(obj) {
  if (!obj || typeof obj !== "object") return false;
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
  }
  return false;
}

export const STAGGER_PROVIDERS = Object.freeze({
  codex: Object.freeze({
    label: "OpenAI Codex",
    autoPing: true,
    session: Object.freeze({
      durationMs: 18000000,
      resetMode: "sliding",
      reason: null,
    }),
    weekly: Object.freeze({
      durationMs: 604800000,
      resetMode: "observed-sliding",
      reason: null,
    }),
  }),
  claude: Object.freeze({
    label: "Claude",
    autoPing: true,
    session: Object.freeze({
      durationMs: 18000000,
      resetMode: "first-use",
      reason: null,
    }),
    weekly: Object.freeze({
      durationMs: 604800000,
      resetMode: "observed-sliding",
      reason: "Weekly window is not shiftable unless observed sliding",
    }),
  }),
  antigravity: Object.freeze({
    label: "Antigravity",
    autoPing: false,
    session: Object.freeze({
      durationMs: null,
      resetMode: "unsupported",
      reason: "Antigravity windows unsupported for safe warming or stagger scheduling",
    }),
    weekly: Object.freeze({
      durationMs: null,
      resetMode: "unsupported",
      reason: "Antigravity windows unsupported for safe warming or stagger scheduling",
    }),
  }),
});

export function getStaggerPolicyMemberIds(group, connections, policyKey) {
  if (!group || !Array.isArray(group.connectionIds) || !policyKey) return [];
  const connectionList = Array.isArray(connections)
    ? connections
    : Object.values(connections || {});
  const connectionMap = new Map();
  for (const c of connectionList) {
    if (c && typeof c.id === "string") {
      connectionMap.set(c.id, c);
    }
  }
  return group.connectionIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => {
      if (!id) return false;
      const conn = connectionMap.get(id);
      if (!conn || conn.isActive === false || conn.authType !== "oauth") return false;
      const providerConfig = STAGGER_PROVIDERS[conn.provider];
      if (!providerConfig || providerConfig.autoPing !== true) return false;
      const policyDesc = providerConfig[policyKey];
      if (!policyDesc || policyDesc.resetMode === "unsupported") return false;
      return typeof policyDesc.durationMs === "number" && Number.isFinite(policyDesc.durationMs) && policyDesc.durationMs > 0;
    });
}

export function validateStaggerGroups(value, connections, previousGroups = [], nowMs = Date.now()) {
  if (!Array.isArray(value)) {
    throw new Error("quotaStaggerGroups must be an array");
  }
  if (value.length > 20) {
    throw new Error("Maximum 20 quota stagger groups allowed");
  }

  const connectionList = Array.isArray(connections)
    ? connections
    : Object.values(connections || {});
  const connectionMap = new Map();
  for (const conn of connectionList) {
    if (conn && typeof conn.id === "string") {
      connectionMap.set(conn.id, conn);
    }
  }

  const prevGroupsList = Array.isArray(previousGroups)
    ? previousGroups
    : Object.values(previousGroups || {});
  const prevGroupsMap = new Map();
  for (const prev of prevGroupsList) {
    if (prev && typeof prev.id === "string") {
      prevGroupsMap.set(prev.id, prev);
    }
  }

  const seenGroupIds = new Set();
  const enabledConnIds = new Set();
  const canonicalGroups = [];

  for (const rawGroup of value) {
    if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup)) {
      throw new Error("Group must be an object");
    }
    if (hasForbiddenKey(rawGroup)) {
      throw new Error("Forbidden prototype key detected");
    }

    const rawId = rawGroup.id;
    if (typeof rawId !== "string") {
      throw new Error("Group id must be a string");
    }
    const id = rawId.trim();
    if (!id || id.length > 100 || FORBIDDEN_KEYS.has(id)) {
      throw new Error("Group id must be a valid non-empty string");
    }
    if (seenGroupIds.has(id)) {
      throw new Error(`Duplicate group id: ${id}`);
    }
    seenGroupIds.add(id);

    const rawName = rawGroup.name;
    if (typeof rawName !== "string") {
      throw new Error("Group name must be a string");
    }
    const name = rawName.trim();
    if (!name || name.length > 100 || FORBIDDEN_KEYS.has(name)) {
      throw new Error("Group name must be a valid non-empty string");
    }

    if (typeof rawGroup.enabled !== "boolean") {
      throw new Error("Group enabled must be a boolean");
    }
    const enabled = rawGroup.enabled;

    let protectWindowStart = false;
    if (rawGroup.protectWindowStart !== undefined) {
      if (typeof rawGroup.protectWindowStart !== "boolean") {
        throw new Error("Group protectWindowStart must be a boolean");
      }
      protectWindowStart = rawGroup.protectWindowStart;
    }

    if (!Array.isArray(rawGroup.connectionIds)) {
      throw new Error("Group connectionIds must be an array");
    }
    if (rawGroup.connectionIds.length > 100) {
      throw new Error("Group connectionIds count exceeds limit");
    }

    const seenConnIdsInGroup = new Set();
    const sanitizedConnIds = [];

    for (const rawConnId of rawGroup.connectionIds) {
      if (typeof rawConnId !== "string") {
        throw new Error("Connection ID must be a string");
      }
      const connId = rawConnId.trim();
      if (!connId || connId.length > 100 || FORBIDDEN_KEYS.has(connId)) {
        throw new Error("Connection ID must be a valid non-empty string");
      }
      if (seenConnIdsInGroup.has(connId)) {
        throw new Error(`Duplicate connection ID in group: ${connId}`);
      }
      seenConnIdsInGroup.add(connId);

      if (enabled) {
        const conn = connectionMap.get(connId);
        if (!conn) {
          throw new Error(`Connection not found: ${connId}`);
        }
        if (conn.isActive === false) {
          throw new Error(`Connection is not active: ${connId}`);
        }
        if (conn.authType !== "oauth") {
          throw new Error(`Connection is not OAuth: ${connId}`);
        }
        if (!Object.prototype.hasOwnProperty.call(STAGGER_PROVIDERS, conn.provider)) {
          throw new Error(`Unsupported provider: ${conn.provider}`);
        }
      }

      sanitizedConnIds.push(connId);
    }

    if (!rawGroup.session || typeof rawGroup.session !== "object" || Array.isArray(rawGroup.session) || hasForbiddenKey(rawGroup.session)) {
      throw new Error("Group session policy must be an object");
    }
    if (typeof rawGroup.session.enabled !== "boolean") {
      throw new Error("Session policy enabled must be a boolean");
    }

    if (!rawGroup.weekly || typeof rawGroup.weekly !== "object" || Array.isArray(rawGroup.weekly) || hasForbiddenKey(rawGroup.weekly)) {
      throw new Error("Group weekly policy must be an object");
    }
    if (typeof rawGroup.weekly.enabled !== "boolean") {
      throw new Error("Weekly policy enabled must be a boolean");
    }

    if (enabled) {
      if (sanitizedConnIds.length < 2) {
        throw new Error("Group must contain at least 2 distinct active OAuth connections");
      }
      if (!rawGroup.session.enabled && !rawGroup.weekly.enabled) {
        throw new Error("Enabled group must have at least one policy (session or weekly) enabled");
      }
      for (const connId of sanitizedConnIds) {
        if (enabledConnIds.has(connId)) {
          throw new Error(`Connection ${connId} belongs to multiple enabled groups`);
        }
        enabledConnIds.add(connId);
      }
    }

    const prevGroup = prevGroupsMap.get(id);

    let sessionAnchorAt = null;
    if (enabled && rawGroup.session.enabled) {
      if (prevGroup?.enabled && prevGroup.session?.enabled && prevGroup.session?.anchorAt && typeof prevGroup.session.anchorAt === "string") {
        sessionAnchorAt = prevGroup.session.anchorAt;
      } else {
        sessionAnchorAt = new Date(nowMs).toISOString();
      }
    }

    let weeklyAnchorAt = null;
    if (enabled && rawGroup.weekly.enabled) {
      if (prevGroup?.enabled && prevGroup.weekly?.enabled && prevGroup.weekly?.anchorAt && typeof prevGroup.weekly.anchorAt === "string") {
        weeklyAnchorAt = prevGroup.weekly.anchorAt;
      } else {
        weeklyAnchorAt = new Date(nowMs).toISOString();
      }
    }

    canonicalGroups.push({
      id,
      name,
      enabled,
      connectionIds: sanitizedConnIds,
      session: {
        enabled: rawGroup.session.enabled,
        anchorAt: sessionAnchorAt,
      },
      weekly: {
        enabled: rawGroup.weekly.enabled,
        anchorAt: weeklyAnchorAt,
      },
      protectWindowStart,
    });
  }

  return canonicalGroups;
}

export function getStaggerGroup(settings, connectionId) {
  if (!settings || !connectionId || typeof connectionId !== "string") return null;
  const groups = settings.quotaStaggerGroups;
  if (!Array.isArray(groups)) return null;
  const cleanId = connectionId.trim();
  for (const group of groups) {
    if (!group || group.enabled !== true) continue;
    if (group.session?.enabled !== true && group.weekly?.enabled !== true) continue;
    if (Array.isArray(group.connectionIds) && group.connectionIds.includes(cleanId)) {
      return group;
    }
  }
  return null;
}

export function isStaggerAutoPingEnabled(settings, connection) {
  if (!connection) return false;
  const connId = typeof connection === "object" ? connection.id : connection;
  const group = getStaggerGroup(settings, connId);
  if (!group) return false;
  const provider = typeof connection === "object" ? connection.provider : null;
  if (!provider) return false;
  const providerConfig = STAGGER_PROVIDERS[provider];
  return providerConfig?.autoPing === true;
}

function computeGroupSignature(group, connections) {
  const connectionList = Array.isArray(connections)
    ? connections
    : Object.values(connections || {});
  const connectionMap = new Map();
  for (const c of connectionList) {
    if (c && typeof c.id === "string") {
      connectionMap.set(c.id, c);
    }
  }

  const connSig = (group.connectionIds || [])
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id) => {
      const conn = connectionMap.get(id);
      return conn && conn.isActive !== false && conn.authType === "oauth" && Object.prototype.hasOwnProperty.call(STAGGER_PROVIDERS, conn.provider);
    })
    .map((id) => `${id}:${connectionMap.get(id)?.provider || ""}`)
    .join(",");
  const sessionSig = group.session?.enabled ? `s:${group.session?.anchorAt || ""}` : "s:off";
  const weeklySig = group.weekly?.enabled ? `w:${group.weekly?.anchorAt || ""}` : "w:off";
  const protectSig = group.protectWindowStart ? "p:1" : "p:0";
  return `${group.id}|${connSig}|${sessionSig}|${weeklySig}|${protectSig}`;
}

function resolveWindowDuration(provider, policyKey, quota) {
  const hasWindowDurationMs = quota != null && quota.windowDurationMs !== undefined;
  const hasLimitWindowSeconds = quota != null && quota.limit_window_seconds !== undefined;

  if (hasWindowDurationMs || hasLimitWindowSeconds) {
    if (hasWindowDurationMs) {
      if (typeof quota.windowDurationMs !== "number" || !Number.isFinite(quota.windowDurationMs) || quota.windowDurationMs <= 0) {
        return null;
      }
    }
    if (hasLimitWindowSeconds) {
      if (typeof quota.limit_window_seconds !== "number" || !Number.isFinite(quota.limit_window_seconds) || quota.limit_window_seconds <= 0) {
        return null;
      }
    }
    if (hasWindowDurationMs) {
      return quota.windowDurationMs;
    }
    return quota.limit_window_seconds * 1000;
  }

  if (provider === "codex") {
    return policyKey === "session" ? 18000000 : 604800000;
  }
  if (provider === "claude") {
    return policyKey === "session" ? 18000000 : 604800000;
  }
  return null;
}

function calculateNextPhaseSlot({ anchorMs, index, N, durationMs, nowMs, graceMs = 150000 }) {
  if (
    !Number.isFinite(anchorMs) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(N) ||
    N <= 0 ||
    !Number.isFinite(index) ||
    index < 0 ||
    !Number.isFinite(nowMs)
  ) {
    return nowMs;
  }
  const phaseOffset = (index / N) * durationMs;
  const targetSlot0 = anchorMs + phaseOffset;
  const timeOffset = (nowMs - graceMs) - targetSlot0;
  if (timeOffset < 0) {
    return Math.round(targetSlot0);
  }
  const cycles = Math.floor(timeOffset / durationMs) + 1;
  return Math.round(targetSlot0 + cycles * durationMs);
}

function findQuotaForPolicy(quotas, policyKey) {
  if (!quotas || typeof quotas !== "object") return null;
  if (policyKey === "session") {
    return quotas.session || quotas["session (5h)"] || null;
  }
  if (policyKey === "weekly") {
    return quotas.weekly || quotas["weekly (7d)"] || null;
  }
  return null;
}

export function updateStaggerState({ connection, settings, connections, quotas, nowMs = Date.now(), observedAtMs = null }) {
  const prevState = connection?.quotaStaggerState && typeof connection.quotaStaggerState === "object"
    ? connection.quotaStaggerState
    : {};

  const group = getStaggerGroup(settings, connection?.id);
  if (!group) return null;

  const signature = computeGroupSignature(group, connections);
  const isSignatureValid = prevState.signature === signature;

  const rawObservedAtMs = observedAtMs !== null && observedAtMs !== undefined
    ? observedAtMs
    : (quotas && quotas.observedAtMs !== undefined && quotas.observedAtMs !== null ? quotas.observedAtMs : nowMs);
  const sampleObservedAtMs = typeof rawObservedAtMs === "number" ? rawObservedAtMs : Number(rawObservedAtMs);

  const providerConfig = STAGGER_PROVIDERS[connection.provider];
  if (!providerConfig || providerConfig.autoPing === false || providerConfig.session.resetMode === "unsupported") {
    return {
      groupId: group.id,
      signature,
      lastObservedAtMs: nowMs,
      lastPingAtMs: prevState.lastPingAtMs || null,
      suppressUntilMs: null,
      observations: {},
      pendingSlots: {},
      effectiveDeadlineMs: null,
      waiting: false,
      notBeforeMs: null,
      ready: false,
      windowStatus: {
        session: "unsupported",
        weekly: "unsupported",
      },
      reason: providerConfig?.session?.reason || "Unsupported provider for stagger scheduling",
    };
  }

  if (!Number.isFinite(sampleObservedAtMs) || sampleObservedAtMs > nowMs + 60000 || nowMs - sampleObservedAtMs > 600000) {
    return {
      groupId: group.id,
      signature,
      lastObservedAtMs: nowMs,
      lastPingAtMs: prevState.lastPingAtMs || null,
      suppressUntilMs: null,
      observations: isSignatureValid ? (prevState.observations || {}) : {},
      pendingSlots: {},
      effectiveDeadlineMs: null,
      waiting: false,
      notBeforeMs: null,
      ready: false,
      windowStatus: {
        session: "stale_sample",
        weekly: "stale_sample",
      },
      reason: "Expired upstream quota sample",
    };
  }

  const activeSuppressUntil = prevState.suppressUntilMs && nowMs < prevState.suppressUntilMs
    ? prevState.suppressUntilMs
    : null;

  const validObs = isSignatureValid ? (prevState.observations || {}) : {};
  const validPending = isSignatureValid ? (prevState.pendingSlots || {}) : {};

  let nextPending = { ...validPending };
  const nextObs = { ...validObs };
  const windowStatus = {};
  let generalReason = null;

  const policyKeys = ["session", "weekly"];
  for (const policyKey of policyKeys) {
    if (!group[policyKey]?.enabled) {
      windowStatus[policyKey] = "disabled";
      delete nextPending[policyKey];
      continue;
    }

    const policyMemberIds = getStaggerPolicyMemberIds(group, connections, policyKey);
    const policyIndex = policyMemberIds.indexOf(connection.id);
    const policyN = policyMemberIds.length;

    if (policyN < 2 || policyIndex === -1) {
      windowStatus[policyKey] = "observation_only";
      delete nextPending[policyKey];
      generalReason = "Fewer than 2 active eligible members for policy";
      continue;
    }

    const quota = findQuotaForPolicy(quotas, policyKey);
    if (!quota || typeof quota !== "object") {
      windowStatus[policyKey] = "missing";
      delete nextPending[policyKey];
      continue;
    }

    let used = quota.used !== undefined ? quota.used : quota.utilization;
    if (typeof used === "string" && used.trim() !== "") used = Number(used);
    let remaining = quota.remaining !== undefined ? quota.remaining : null;
    if (typeof remaining === "string" && remaining.trim() !== "") remaining = Number(remaining);
    let total = quota.total !== undefined ? quota.total : 100;
    if (typeof total === "string" && total.trim() !== "") total = Number(total);

    if (used === undefined || used === null || !Number.isFinite(used)) {
      if (remaining !== null && Number.isFinite(remaining) && Number.isFinite(total)) {
        used = total - remaining;
      }
    }

    if (
      used === undefined ||
      used === null ||
      !Number.isFinite(used) ||
      used < 0 ||
      !Number.isFinite(total) ||
      total <= 0 ||
      used > total ||
      (remaining !== null && (remaining < 0 || remaining > total))
    ) {
      windowStatus[policyKey] = "invalid";
      delete nextPending[policyKey];
      continue;
    }

    if (used > 0) {
      windowStatus[policyKey] = "active";
      delete nextPending[policyKey];
      nextObs[policyKey] = {
        resetAt: quota.resetAt || null,
        resetMs: quota.resetAt ? new Date(quota.resetAt).getTime() : null,
        observedAtMs: sampleObservedAtMs,
        used,
        isIdle: false,
      };
      continue;
    }

    const durationMs = resolveWindowDuration(connection.provider, policyKey, quota);
    if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs === Infinity) {
      windowStatus[policyKey] = "unsupported";
      delete nextPending[policyKey];
      continue;
    }

    const resetAt = quota.resetAt || null;
    const resetMs = resetAt ? new Date(resetAt).getTime() : null;
    const prevObs = validObs[policyKey];

    const isPrePingSample = Boolean(
      prevState.lastPingAtMs &&
      sampleObservedAtMs <= prevState.lastPingAtMs
    );

    const isIdenticalSample = Boolean(
      prevObs &&
      Number.isFinite(prevObs.observedAtMs) &&
      sampleObservedAtMs === prevObs.observedAtMs &&
      resetMs === prevObs.resetMs
    );

    if (isPrePingSample) {
      windowStatus[policyKey] = policyKey === "weekly" ? "observation_only" : (connection.provider === "claude" ? "fixed" : "observing");
      delete nextPending[policyKey];
      nextObs[policyKey] = { resetAt, resetMs, observedAtMs: sampleObservedAtMs, used, isIdle: true };
      continue;
    }

    if (isIdenticalSample) {
      if (validPending[policyKey] && !activeSuppressUntil) {
        nextPending[policyKey] = validPending[policyKey];
        windowStatus[policyKey] = "inactive";
        nextObs[policyKey] = prevObs;
        continue;
      }
      windowStatus[policyKey] = policyKey === "weekly" ? "observation_only" : (connection.provider === "claude" ? "fixed" : "observing");
      delete nextPending[policyKey];
      nextObs[policyKey] = prevObs;
      continue;
    }

    const isPrevObsFresh = Boolean(
      prevObs &&
      Number.isFinite(prevObs.observedAtMs) &&
      sampleObservedAtMs - prevObs.observedAtMs >= 10000 &&
      sampleObservedAtMs - prevObs.observedAtMs <= 600000
    );
    const prevWasIdle = Boolean(isPrevObsFresh && prevObs.used === 0 && prevObs.isIdle === true);

    let isInactive = false;

    if (connection.provider === "claude" && policyKey === "session") {
      if (resetAt === null || resetMs === null) {
        isInactive = true;
      } else if (Number.isFinite(resetMs) && resetMs <= sampleObservedAtMs) {
        isInactive = true;
      } else {
        windowStatus[policyKey] = "fixed";
        delete nextPending[policyKey];
        nextObs[policyKey] = { resetAt, resetMs, observedAtMs: sampleObservedAtMs, used, isIdle: true };
        continue;
      }
    } else if (connection.provider === "codex" && policyKey === "session") {
      if (!resetAt || !Number.isFinite(resetMs)) {
        windowStatus[policyKey] = "invalid";
        delete nextPending[policyKey];
        continue;
      }
      const timeUntilReset = resetMs - sampleObservedAtMs;
      const diffFromDuration = Math.abs(timeUntilReset - durationMs);
      const isRoughlyNowPlusDuration = diffFromDuration <= 300000;

      if (prevWasIdle && Number.isFinite(prevObs.resetMs)) {
        const slideMs = resetMs - prevObs.resetMs;
        const elapsedMs = sampleObservedAtMs - prevObs.observedAtMs;
        const isElapsedConsistent = slideMs >= 30000 && Math.abs(slideMs - elapsedMs) <= 30000;

        if (isElapsedConsistent && isRoughlyNowPlusDuration) {
          isInactive = true;
        } else if (!isElapsedConsistent && !isRoughlyNowPlusDuration) {
          windowStatus[policyKey] = "active";
          delete nextPending[policyKey];
          nextObs[policyKey] = { resetAt, resetMs, observedAtMs: sampleObservedAtMs, used, isIdle: true };
          continue;
        }
      }
      if (!isInactive) {
        windowStatus[policyKey] = "observing";
        delete nextPending[policyKey];
        nextObs[policyKey] = { resetAt, resetMs, observedAtMs: sampleObservedAtMs, used, isIdle: true };
        continue;
      }
    } else if (policyKey === "weekly") {
      if (!resetAt || !Number.isFinite(resetMs)) {
        windowStatus[policyKey] = "invalid";
        delete nextPending[policyKey];
        continue;
      }
      const timeUntilReset = resetMs - sampleObservedAtMs;
      const diffFromDuration = Math.abs(timeUntilReset - durationMs);
      const isRoughlyNowPlusDuration = diffFromDuration <= 300000;

      if (prevWasIdle && Number.isFinite(prevObs.resetMs)) {
        const slideMs = resetMs - prevObs.resetMs;
        const elapsedMs = sampleObservedAtMs - prevObs.observedAtMs;
        const isElapsedConsistent = slideMs >= 30000 && Math.abs(slideMs - elapsedMs) <= 30000;

        if (isElapsedConsistent && isRoughlyNowPlusDuration) {
          isInactive = true;
        }
      }
      if (!isInactive) {
        windowStatus[policyKey] = "observation_only";
        delete nextPending[policyKey];
        nextObs[policyKey] = { resetAt, resetMs, observedAtMs: sampleObservedAtMs, used, isIdle: true };
        continue;
      }
    }

    if (isInactive) {
      windowStatus[policyKey] = "inactive";
      nextObs[policyKey] = { resetAt, resetMs, observedAtMs: sampleObservedAtMs, used, isIdle: true };
      if (!nextPending[policyKey]) {
        const anchorMs = new Date(group[policyKey].anchorAt).getTime();
        nextPending[policyKey] = calculateNextPhaseSlot({
          anchorMs,
          index: policyIndex,
          N: policyN,
          durationMs,
          nowMs: sampleObservedAtMs,
          graceMs: 150000,
        });
      }
    }
  }

  let effectiveDeadlineMs = null;
  if (nextPending.session && nextPending.weekly) {
    effectiveDeadlineMs = Math.max(nextPending.session, nextPending.weekly);
  } else if (nextPending.session) {
    effectiveDeadlineMs = nextPending.session;
  } else if (nextPending.weekly) {
    effectiveDeadlineMs = nextPending.weekly;
  }

  let waiting = false;
  let ready = false;
  let notBeforeMs = null;

  if (effectiveDeadlineMs !== null) {
    notBeforeMs = effectiveDeadlineMs;
    if (nowMs < effectiveDeadlineMs) {
      waiting = true;
      ready = false;
    } else {
      waiting = false;
      ready = true;
    }
  }

  if (activeSuppressUntil) {
    nextPending = {};
    effectiveDeadlineMs = null;
    waiting = false;
    ready = false;
    notBeforeMs = null;
  }

  return {
    groupId: group.id,
    signature,
    lastObservedAtMs: sampleObservedAtMs,
    lastPingAtMs: prevState.lastPingAtMs || null,
    suppressUntilMs: activeSuppressUntil,
    observations: nextObs,
    pendingSlots: nextPending,
    effectiveDeadlineMs,
    waiting,
    notBeforeMs,
    ready,
    windowStatus,
    reason: generalReason,
  };
}

export function getStaggerDecision({ connection, settings, connections, nowMs = Date.now() }) {
  const empty = { groupId: null, waiting: false, notBeforeMs: null, ready: false };
  if (!connection || !settings) return empty;

  const group = getStaggerGroup(settings, connection.id);
  if (!group) return empty;

  const expectedSignature = computeGroupSignature(group, connections);
  const state = connection.quotaStaggerState;
  if (!state || typeof state !== "object") {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }

  if (state.signature !== expectedSignature) {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }

  if (!Number.isFinite(state.lastObservedAtMs) || state.lastObservedAtMs > nowMs + 60000) {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }

  if (nowMs - state.lastObservedAtMs > 600000) {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }

  if (state.effectiveDeadlineMs == null || !Number.isFinite(state.effectiveDeadlineMs)) {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }

  if (nowMs < state.effectiveDeadlineMs) {
    return {
      groupId: group.id,
      waiting: true,
      notBeforeMs: state.effectiveDeadlineMs,
      ready: false,
    };
  }

  return {
    groupId: group.id,
    waiting: false,
    notBeforeMs: state.effectiveDeadlineMs,
    ready: true,
  };
}

export function markStaggerPing(state, nowMs = Date.now(), suppressionMs = 300000) {
  if (!state || typeof state !== "object") return state;
  const duration = Number.isFinite(suppressionMs) && suppressionMs > 0 ? suppressionMs : 300000;
  return {
    ...state,
    pendingSlots: {},
    effectiveDeadlineMs: null,
    waiting: false,
    ready: false,
    notBeforeMs: null,
    lastPingAtMs: nowMs,
    suppressUntilMs: nowMs + duration,
  };
}

const LEGACY_AUTOPING_KEYS = ["claudeAutoPing", "codexAutoPing"];

export function hasQuotaAutoPingEnabled(settings) {
  const legacyEnabled = LEGACY_AUTOPING_KEYS.some((key) =>
    Object.values(settings?.[key]?.connections || {}).some(Boolean)
  );
  const staggerGroups = settings?.quotaStaggerGroups;
  const staggerEnabled = Array.isArray(staggerGroups) && staggerGroups.some(
    (g) => g?.enabled === true && (g.session?.enabled === true || g.weekly?.enabled === true)
  );
  return Boolean(legacyEnabled || staggerEnabled);
}
