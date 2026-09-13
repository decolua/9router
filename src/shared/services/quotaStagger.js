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

export const STAGGER_SIGNATURE_VERSION = "v3";
export const STAGGER_SCHEMA_VERSION = "v3";

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

export function computeGroupSignature(group, connections) {
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
      return (
        conn &&
        conn.isActive !== false &&
        conn.authType === "oauth" &&
        Object.prototype.hasOwnProperty.call(STAGGER_PROVIDERS, conn.provider)
      );
    })
    .map((id) => `${id}:${connectionMap.get(id)?.provider || ""}`)
    .join(",");
  const sessionSig = group.session?.enabled ? `s:${group.session?.anchorAt || ""}` : "s:off";
  const weeklySig = group.weekly?.enabled ? `w:${group.weekly?.anchorAt || ""}` : "w:off";
  const protectSig = group.protectWindowStart ? "p:1" : "p:0";
  return `${STAGGER_SCHEMA_VERSION}|${group.id}|${connSig}|${sessionSig}|${weeklySig}|${protectSig}`;
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

function strictNextBoundary({ anchorMs, index, N, durationMs, earliestMs }) {
  if (
    !Number.isFinite(anchorMs) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(N) ||
    N <= 0 ||
    !Number.isFinite(index) ||
    index < 0 ||
    index >= N ||
    !Number.isFinite(earliestMs)
  ) {
    return earliestMs;
  }
  const offsetMs = (index / N) * durationMs;
  const cycle = Math.max(0, Math.ceil((earliestMs - anchorMs - offsetMs) / durationMs));
  return Math.round(anchorMs + offsetMs + cycle * durationMs);
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

function isFiniteReset(resetMs) {
  return Number.isFinite(resetMs) && resetMs > 0;
}

function isFreshObservation(previous, observedAtMs) {
  return Boolean(
    previous &&
    Number.isFinite(previous.observedAtMs) &&
    observedAtMs > previous.observedAtMs &&
    observedAtMs - previous.observedAtMs >= 10000 &&
    observedAtMs - previous.observedAtMs <= 600000
  );
}

function isSlidingIdleObservation(previous, resetMs, observedAtMs, durationMs) {
  if (!isFreshObservation(previous, observedAtMs) || previous.used !== 0) return false;
  if (!isFiniteReset(previous.resetMs) || !isFiniteReset(resetMs)) return false;
  const elapsedMs = observedAtMs - previous.observedAtMs;
  const resetSlideMs = resetMs - previous.resetMs;
  return (
    resetSlideMs >= 30000 &&
    Math.abs(resetSlideMs - elapsedMs) <= 30000 &&
    Math.abs((resetMs - observedAtMs) - durationMs) <= 300000
  );
}

function samePhaseAnchor(a, b, durationMs) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(durationMs) || durationMs <= 0) return false;
  const delta = Math.abs(a - b) % durationMs;
  return delta <= 1000 || Math.abs(delta - durationMs) <= 1000;
}

function getReferenceAnchor({ policyKey, policyIndex, policyMemberIds, connectionMap, signature, fallbackAnchorMs }) {
  if (policyIndex === 0) return null;
  const leader = connectionMap.get(policyMemberIds[0]);
  const state = leader?.quotaStaggerState;
  if (state?.signature === signature) {
    const observation = state.observations?.[policyKey];
    const plan = state.plannedSlots?.[policyKey];
    if (observation?.status === "active" && Number.isFinite(observation.activeAnchorMs)) {
      return observation.activeAnchorMs;
    }
    if (plan && Number.isFinite(plan.referenceAnchorMs)) {
      return plan.referenceAnchorMs;
    }
    if (Number.isFinite(state.phaseAnchors?.[policyKey])) {
      return state.phaseAnchors[policyKey];
    }
  }
  return Number.isFinite(fallbackAnchorMs) ? fallbackAnchorMs : null;
}

function deriveStaggerDecision(state, nowMs) {
  const candidateDeadlines = [];
  let unresolvedExpiredPlan = false;
  let hasInactivePendingDue = false;

  const inactivePolicies = ["session", "weekly"].filter((key) =>
    state.windowStatus?.[key] === "inactive" && Number.isFinite(state.pendingSlots?.[key])
  );
  const governingPolicy = inactivePolicies.sort((a, b) =>
    (state.observations?.[b]?.durationMs || 0) - (state.observations?.[a]?.durationMs || 0)
  )[0];

  for (const policyKey of ["session", "weekly"]) {
    const plan = state.plannedSlots?.[policyKey];
    const status = state.windowStatus?.[policyKey];
    const pending = state.pendingSlots?.[policyKey];

    if (plan && Number.isFinite(plan.resetMs) && nowMs >= plan.resetMs) {
      if (Number.isFinite(plan.guardUntilMs) && nowMs < plan.guardUntilMs) {
        candidateDeadlines.push(plan.guardUntilMs);
        unresolvedExpiredPlan = true;
      } else if (!Number.isFinite(plan.guardUntilMs) && status !== "inactive") {
        const target = Number.isFinite(plan.notBeforeMs) ? plan.notBeforeMs : plan.resetMs;
        if (nowMs < target) {
          candidateDeadlines.push(target);
          unresolvedExpiredPlan = true;
        }
      }
    }

    if (status === "inactive" && Number.isFinite(pending)) {
      if (!governingPolicy || policyKey === governingPolicy) {
        candidateDeadlines.push(pending);
      }
      if (nowMs >= pending) {
        hasInactivePendingDue = true;
      }
    }
  }

  if (candidateDeadlines.length === 0 && (!state.plannedSlots || Object.keys(state.plannedSlots).length === 0)) {
    if (Number.isFinite(state.effectiveDeadlineMs)) {
      candidateDeadlines.push(state.effectiveDeadlineMs);
      if (nowMs >= state.effectiveDeadlineMs) {
        hasInactivePendingDue = true;
      }
    }
  }

  if (candidateDeadlines.length === 0) {
    return { waiting: false, notBeforeMs: null, ready: false, effectiveDeadlineMs: null };
  }

  const effectiveDeadlineMs = Math.max(...candidateDeadlines);
  const isWaiting = unresolvedExpiredPlan || nowMs < effectiveDeadlineMs;

  return {
    waiting: isWaiting,
    notBeforeMs: effectiveDeadlineMs,
    ready: !isWaiting && hasInactivePendingDue,
    effectiveDeadlineMs,
  };
}

export function updateStaggerState({ connection, settings, connections, quotas, nowMs = Date.now(), observedAtMs = null }) {
  const group = getStaggerGroup(settings, connection?.id);
  if (!group) return null;

  const signature = computeGroupSignature(group, connections);
  const previous = connection?.quotaStaggerState && typeof connection.quotaStaggerState === "object"
    ? connection.quotaStaggerState
    : {};
  const signatureValid = previous.signature === signature;
  const rawObservedAtMs = observedAtMs ?? quotas?.observedAtMs ?? nowMs;
  const sampleObservedAtMs = typeof rawObservedAtMs === "number" ? rawObservedAtMs : Number(rawObservedAtMs);
  const provider = STAGGER_PROVIDERS[connection?.provider];

  if (!provider || provider.autoPing !== true || provider.session.resetMode === "unsupported") {
    return {
      groupId: group.id,
      signature,
      lastObservedAtMs: nowMs,
      lastPingAtMs: previous.lastPingAtMs || null,
      suppressUntilMs: null,
      phaseAnchors: {},
      plannedSlots: {},
      pendingSlots: {},
      observations: {},
      effectiveDeadlineMs: null,
      waiting: false,
      notBeforeMs: null,
      ready: false,
      windowStatus: { session: "unsupported", weekly: "unsupported" },
      reason: provider?.session?.reason || "Unsupported provider for stagger scheduling",
    };
  }

  if (!Number.isFinite(sampleObservedAtMs) || sampleObservedAtMs > nowMs + 60000 || nowMs - sampleObservedAtMs > 600000) {
    return {
      groupId: group.id,
      signature,
      lastObservedAtMs: nowMs,
      lastPingAtMs: previous.lastPingAtMs || null,
      suppressUntilMs: null,
      phaseAnchors: {},
      plannedSlots: {},
      pendingSlots: {},
      observations: {},
      effectiveDeadlineMs: null,
      waiting: false,
      notBeforeMs: null,
      ready: false,
      windowStatus: { session: "stale_sample", weekly: "stale_sample" },
      reason: "Expired upstream quota sample",
    };
  }

  const connectionList = Array.isArray(connections) ? connections : Object.values(connections || {});
  const connectionMap = new Map(connectionList.filter((item) => item?.id).map((item) => [item.id, item]));
  const next = {
    groupId: group.id,
    signature,
    lastObservedAtMs: sampleObservedAtMs,
    lastPingAtMs: previous.lastPingAtMs || null,
    suppressUntilMs: previous.suppressUntilMs && nowMs < previous.suppressUntilMs ? previous.suppressUntilMs : null,
    phaseAnchors: signatureValid ? { ...(previous.phaseAnchors || {}) } : {},
    plannedSlots: signatureValid ? { ...(previous.plannedSlots || {}) } : {},
    pendingSlots: signatureValid ? { ...(previous.pendingSlots || {}) } : {},
    observations: signatureValid ? { ...(previous.observations || {}) } : {},
    windowStatus: {},
    reason: null,
  };

  for (const policyKey of ["session", "weekly"]) {
    if (!group[policyKey]?.enabled) {
      next.windowStatus[policyKey] = "disabled";
      delete next.plannedSlots[policyKey];
      delete next.pendingSlots[policyKey];
      delete next.observations[policyKey];
      continue;
    }

    const memberIds = getStaggerPolicyMemberIds(group, connections, policyKey);
    const index = memberIds.indexOf(connection.id);
    if (memberIds.length < 2 || index < 0) {
      next.windowStatus[policyKey] = "observation_only";
      delete next.plannedSlots[policyKey];
      delete next.pendingSlots[policyKey];
      next.reason = "Fewer than 2 active eligible members for policy";
      continue;
    }

    const quota = findQuotaForPolicy(quotas, policyKey);
    if (!quota || typeof quota !== "object") {
      next.windowStatus[policyKey] = "missing";
      delete next.plannedSlots[policyKey];
      delete next.pendingSlots[policyKey];
      delete next.observations[policyKey];
      continue;
    }

    let used = quota.used ?? quota.utilization;
    if (typeof used === "string" && used.trim() !== "") used = Number(used);
    let remaining = quota.remaining ?? null;
    if (typeof remaining === "string" && remaining.trim() !== "") remaining = Number(remaining);
    let total = quota.total ?? 100;
    if (typeof total === "string" && total.trim() !== "") total = Number(total);
    if (used == null && Number.isFinite(remaining) && Number.isFinite(total)) used = total - remaining;

    const durationMs = resolveWindowDuration(connection.provider, policyKey, quota);
    if (
      !Number.isFinite(used) || used < 0 || !Number.isFinite(total) || total <= 0 || used > total ||
      (remaining !== null && (!Number.isFinite(remaining) || remaining < 0 || remaining > total))
    ) {
      next.windowStatus[policyKey] = "invalid";
      delete next.plannedSlots[policyKey];
      delete next.pendingSlots[policyKey];
      delete next.observations[policyKey];
      continue;
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      next.windowStatus[policyKey] = "unsupported";
      delete next.plannedSlots[policyKey];
      delete next.pendingSlots[policyKey];
      delete next.observations[policyKey];
      continue;
    }

    const resetAt = quota.resetAt || null;
    const resetMs = resetAt ? new Date(resetAt).getTime() : null;
    const previousObservation = signatureValid ? previous.observations?.[policyKey] : null;
    const previousPlan = signatureValid ? previous.plannedSlots?.[policyKey] : null;

    if (previous.lastPingAtMs && sampleObservedAtMs <= previous.lastPingAtMs) {
      next.windowStatus[policyKey] = policyKey === "weekly" ? "observation_only" : (connection.provider === "claude" ? "fixed" : "observing");
      continue;
    }

    const isIdenticalSample = Boolean(
      signatureValid &&
      previousObservation &&
      Number.isFinite(previousObservation.observedAtMs) &&
      sampleObservedAtMs === previousObservation.observedAtMs &&
      resetMs === previousObservation.resetMs
    );

    if (isIdenticalSample) {
      if (next.pendingSlots[policyKey] != null && !next.suppressUntilMs) {
        next.windowStatus[policyKey] = "inactive";
        next.observations[policyKey] = previousObservation;
        continue;
      }
      if (next.plannedSlots[policyKey]) {
        next.windowStatus[policyKey] = previousPlan?.guardUntilMs ? "observation_only" : "active";
        next.observations[policyKey] = previousObservation;
        continue;
      }
      next.windowStatus[policyKey] = policyKey === "weekly" ? "observation_only" : (connection.provider === "claude" ? "fixed" : "observing");
      delete next.pendingSlots[policyKey];
      next.observations[policyKey] = previousObservation;
      continue;
    }

    const futureReset = isFiniteReset(resetMs) && resetMs > sampleObservedAtMs;
    const stableFuture = Boolean(
      futureReset &&
      isFreshObservation(previousObservation, sampleObservedAtMs) &&
      previousObservation.used === 0 &&
      previousObservation.resetMs === resetMs
    );
    const slidingIdle = isSlidingIdleObservation(previousObservation, resetMs, sampleObservedAtMs, durationMs);
    const isLeader = index === 0;
    const fallbackAnchorMs = !isLeader && group[policyKey]?.anchorAt
      ? new Date(group[policyKey].anchorAt).getTime()
      : null;
    let referenceAnchorMs = getReferenceAnchor({
      policyKey,
      policyIndex: index,
      policyMemberIds: memberIds,
      connectionMap,
      signature,
      fallbackAnchorMs,
    });
    let status = policyKey === "weekly" ? "observation_only" : "observing";
    let shiftable = Boolean(previousObservation?.shiftable);

    if (used > 0) {
      status = "active";
      if (isLeader && futureReset) referenceAnchorMs = resetMs - durationMs;
    } else if (connection.provider === "claude" && policyKey === "session" && (!futureReset || resetMs <= sampleObservedAtMs)) {
      status = "idle";
    } else if (slidingIdle) {
      status = "idle";
      if (policyKey === "weekly") shiftable = true;
    } else if (stableFuture) {
      status = "active";
      if (policyKey === "weekly") shiftable = false;
      if (isLeader) referenceAnchorMs = resetMs - durationMs;
    } else if (!futureReset && connection.provider === "claude" && policyKey === "session") {
      status = "idle";
    } else if (!isFiniteReset(resetMs) && !(connection.provider === "claude" && policyKey === "session")) {
      status = "invalid";
    }

    if (isLeader && status === "idle") {
      if (Number.isFinite(previousObservation?.activeAnchorMs)) {
        referenceAnchorMs = previousObservation.activeAnchorMs;
      } else {
        referenceAnchorMs = sampleObservedAtMs;
      }
    }
    if (Number.isFinite(referenceAnchorMs)) {
      next.phaseAnchors[policyKey] = referenceAnchorMs;
    }

    next.observations[policyKey] = {
      resetAt,
      resetMs,
      observedAtMs: sampleObservedAtMs,
      used,
      durationMs,
      status,
      isIdle: status === "idle" || used === 0,
      activeAnchorMs: status === "active" ? referenceAnchorMs : previousObservation?.activeAnchorMs ?? null,
      shiftable,
    };

    if (policyKey === "weekly" && (stableFuture || (used === 0 && futureReset && !slidingIdle))) {
      shiftable = false;
      delete next.plannedSlots[policyKey];
    }

    if (status === "invalid") {
      next.windowStatus[policyKey] = "invalid";
      delete next.plannedSlots[policyKey];
      delete next.pendingSlots[policyKey];
      continue;
    }

    if (status === "active") {
      next.windowStatus[policyKey] = "active";
      delete next.pendingSlots[policyKey];

      const canForecast = policyKey !== "weekly" || shiftable;
      if (!futureReset) {
        delete next.plannedSlots[policyKey];
        continue;
      }
      if (!canForecast) {
        next.plannedSlots[policyKey] = {
          resetMs,
          notBeforeMs: resetMs + 180000,
          durationMs,
          referenceAnchorMs: referenceAnchorMs ?? null,
          guardUntilMs: resetMs + 180000,
        };
        continue;
      }
      if (!Number.isFinite(referenceAnchorMs)) {
        if (!previousPlan || previousPlan.resetMs !== resetMs) delete next.plannedSlots[policyKey];
        continue;
      }
      const notBeforeMs = strictNextBoundary({
        anchorMs: referenceAnchorMs,
        index,
        N: memberIds.length,
        durationMs,
        earliestMs: resetMs,
      });
      if (
        previousPlan &&
        previousPlan.resetMs === resetMs &&
        previousPlan.durationMs === durationMs &&
        samePhaseAnchor(previousPlan.referenceAnchorMs, referenceAnchorMs, durationMs)
      ) {
        next.plannedSlots[policyKey] = previousPlan;
      } else {
        next.plannedSlots[policyKey] = { resetMs, notBeforeMs, durationMs, referenceAnchorMs };
      }
      continue;
    }

    if (status === "idle") {
      next.windowStatus[policyKey] = "inactive";
      let targetMs = null;
      const expiredPlan = previousPlan && Number.isFinite(previousPlan.resetMs) && previousPlan.resetMs <= sampleObservedAtMs
        ? previousPlan
        : null;

      if (isLeader) {
        const oldAnchor = previousObservation?.activeAnchorMs;
        const targetBoundary = Number.isFinite(oldAnchor) ? oldAnchor + durationMs : null;
        if (Number.isFinite(targetBoundary) && sampleObservedAtMs <= targetBoundary + 150000) {
          targetMs = targetBoundary;
        } else {
          referenceAnchorMs = sampleObservedAtMs;
          next.phaseAnchors[policyKey] = referenceAnchorMs;
          targetMs = sampleObservedAtMs;
        }
      } else {
        const previousPending = previous.pendingSlots?.[policyKey];
        if (expiredPlan && sampleObservedAtMs <= expiredPlan.notBeforeMs + 150000) {
          targetMs = expiredPlan.notBeforeMs;
        } else if (previousPending != null && sampleObservedAtMs <= previousPending + 150000) {
          targetMs = previousPending;
        } else if (Number.isFinite(referenceAnchorMs)) {
          targetMs = strictNextBoundary({
            anchorMs: referenceAnchorMs,
            index,
            N: memberIds.length,
            durationMs,
            earliestMs: sampleObservedAtMs,
          });
        }
      }

      if (Number.isFinite(targetMs)) {
        next.pendingSlots[policyKey] = targetMs;
      } else {
        delete next.pendingSlots[policyKey];
      }
      delete next.plannedSlots[policyKey];
      continue;
    }

    if (status === "observing" || status === "observation_only") {
      next.windowStatus[policyKey] = status;
      delete next.pendingSlots[policyKey];
      if (previousPlan && futureReset && (!Number.isFinite(previousPlan.resetMs) || previousPlan.resetMs === resetMs)) {
        next.plannedSlots[policyKey] = previousPlan;
      } else {
        delete next.plannedSlots[policyKey];
      }
      continue;
    }

    next.windowStatus[policyKey] = policyKey === "weekly" && stableFuture ? "fixed" : "observing";
    delete next.pendingSlots[policyKey];
    if (policyKey === "weekly" && stableFuture) delete next.plannedSlots[policyKey];
  }

  if (next.suppressUntilMs) {
    next.pendingSlots = {};
  }
  const derived = deriveStaggerDecision(next, nowMs);
  return { ...next, ...derived };
}

export function getStaggerDecision({ connection, settings, connections, nowMs = Date.now() }) {
  const empty = { groupId: null, waiting: false, notBeforeMs: null, ready: false };
  if (!connection || !settings) return empty;
  const group = getStaggerGroup(settings, connection.id);
  if (!group) return empty;
  const state = connection.quotaStaggerState;
  if (!state || typeof state !== "object" || state.signature !== computeGroupSignature(group, connections)) {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }
  if (!Number.isFinite(state.lastObservedAtMs) || state.lastObservedAtMs > nowMs + 60000 || nowMs - state.lastObservedAtMs > 600000) {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }
  if (state.suppressUntilMs && nowMs < state.suppressUntilMs) {
    return { groupId: group.id, waiting: false, notBeforeMs: null, ready: false };
  }
  const derived = deriveStaggerDecision(state, nowMs);
  return {
    groupId: group.id,
    waiting: derived.waiting,
    notBeforeMs: derived.notBeforeMs,
    ready: derived.ready,
  };
}

export function markStaggerPing(state, nowMs = Date.now(), suppressionMs = 300000) {
  if (!state || typeof state !== "object") return state;
  const duration = Number.isFinite(suppressionMs) && suppressionMs > 0 ? suppressionMs : 300000;
  const nextPlanned = {};
  if (state.plannedSlots) {
    for (const [key, plan] of Object.entries(state.plannedSlots)) {
      if (plan && Number.isFinite(plan.resetMs) && plan.resetMs > nowMs) {
        nextPlanned[key] = plan;
      }
    }
  }
  return {
    ...state,
    pendingSlots: {},
    plannedSlots: nextPlanned,
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
