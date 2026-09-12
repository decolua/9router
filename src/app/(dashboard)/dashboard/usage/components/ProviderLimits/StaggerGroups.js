"use client";

import { useState, useEffect, useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import Toggle from "@/shared/components/Toggle";
import Card from "@/shared/components/Card";
import * as quotaStagger from "@/shared/services/quotaStagger";

const STAGGER_PROVIDERS = quotaStagger.STAGGER_PROVIDERS;

export function getSupportedOAuthConnections(connections) {
  if (!Array.isArray(connections)) return [];
  return connections.filter(
    (c) =>
      c &&
      c.isActive !== false &&
      c.authType === "oauth" &&
      Object.prototype.hasOwnProperty.call(STAGGER_PROVIDERS, c.provider)
  );
}

export function isStaggerGroupsVisible(connections, groups) {
  const supported = getSupportedOAuthConnections(connections);
  const hasExistingGroups = Array.isArray(groups) && groups.length > 0;
  return supported.length >= 2 || hasExistingGroups;
}

export function resolvePolicyMemberIds(group, connections, policyKey) {
  if (typeof quotaStagger.getStaggerPolicyMemberIds === "function") {
    return quotaStagger.getStaggerPolicyMemberIds(group, connections, policyKey);
  }
  if (!group || !Array.isArray(group.connectionIds)) return [];
  const connectionMap = new Map((connections || []).map((c) => [c.id, c]));
  return group.connectionIds.filter((id) => {
    const conn = connectionMap.get(id);
    if (!conn || conn.isActive === false || conn.authType !== "oauth") return false;
    const providerConfig = STAGGER_PROVIDERS[conn.provider];
    if (!providerConfig) return false;
    return providerConfig[policyKey]?.resetMode !== "unsupported";
  });
}

export function getMemberPhaseOffset(connId, policyMemberIds) {
  if (!Array.isArray(policyMemberIds)) return null;
  const index = policyMemberIds.indexOf(connId);
  if (index === -1) return null;
  const N = policyMemberIds.length;
  return { slot: index + 1, total: N, pct: Math.round((index / N) * 100) };
}

export function createDefaultGroup(existingGroups = []) {
  const count = Array.isArray(existingGroups) ? existingGroups.length + 1 : 1;
  return {
    id: crypto.randomUUID(),
    name: `Stagger Group ${count}`,
    enabled: false,
    protectWindowStart: true,
    connectionIds: [],
    session: { enabled: true },
    weekly: { enabled: false },
  };
}

export function reorderConnectionIds(connectionIds, fromIndex, toIndex) {
  if (!Array.isArray(connectionIds)) return [];
  if (fromIndex < 0 || fromIndex >= connectionIds.length || toIndex < 0 || toIndex >= connectionIds.length) {
    return [...connectionIds];
  }
  const next = [...connectionIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function removeConnectionId(connectionIds, idToRemove) {
  if (!Array.isArray(connectionIds)) return [];
  return connectionIds.filter((id) => id !== idToRemove);
}

export async function loadStaggerConnections(fetchImpl = fetch) {
  const firstUrl = "/api/providers/client?pageSize=500&accountStatus=all&provider=all&page=1";
  const firstRes = await fetchImpl(firstUrl, { cache: "no-store" });
  if (!firstRes.ok) {
    throw new Error(`Failed to load providers page 1 (HTTP ${firstRes.status})`);
  }
  const firstData = await firstRes.json();
  const totalPages = Math.max(1, Number(firstData?.pagination?.totalPages) || 1);
  const all = [...(Array.isArray(firstData?.connections) ? firstData.connections : [])];

  if (totalPages > 1) {
    const pagePromises = [];
    for (let p = 2; p <= totalPages; p++) {
      pagePromises.push(
        (async () => {
          const url = `/api/providers/client?pageSize=500&accountStatus=all&provider=all&page=${p}`;
          const res = await fetchImpl(url, { cache: "no-store" });
          if (!res.ok) {
            throw new Error(`Failed to load providers page ${p} (HTTP ${res.status})`);
          }
          const data = await res.json();
          return Array.isArray(data?.connections) ? data.connections : [];
        })()
      );
    }
    const subsequentPages = await Promise.all(pagePromises);
    for (const pageList of subsequentPages) {
      all.push(...pageList);
    }
  }

  const seenIds = new Set();
  const deduped = [];
  for (const conn of all) {
    if (conn && conn.id && !seenIds.has(conn.id)) {
      seenIds.add(conn.id);
      deduped.push(conn);
    }
  }
  return deduped;
}

export default function StaggerGroups() {
  const [connections, setConnections] = useState([]);
  const [groups, setGroups] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [draftGroup, setDraftGroup] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load settings (HTTP ${res.status})`);
        return res.json();
      }),
      loadStaggerConnections(),
    ])
      .then(([settingsData, allConnections]) => {
        if (active) {
          setGroups(Array.isArray(settingsData.quotaStaggerGroups) ? settingsData.quotaStaggerGroups : []);
          setConnections(allConnections);
          setIsLoaded(true);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Failed to load quota stagger configuration");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const connectionMap = useMemo(() => new Map(connections.filter(Boolean).map((c) => [c.id, c])), [connections]);

  const eligibleConnections = useMemo(
    () => connections.filter((c) => c && c.authType === "oauth" && Boolean(STAGGER_PROVIDERS[c.provider])),
    [connections]
  );

  const visible = isStaggerGroupsVisible(connections, groups);

  const saveGroups = async (nextGroups) => {
    if (!isLoaded) return;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotaStaggerGroups: nextGroups }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save quota stagger settings");
      setGroups(Array.isArray(data.quotaStaggerGroups) ? data.quotaStaggerGroups : nextGroups);
      setEditingGroupId(null);
      setDraftGroup(null);
      setSuccessMessage("Quota stagger configuration saved");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message || "Failed to save quota stagger settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = () => {
    if (!draftGroup || !isLoaded) return;
    if (!draftGroup.name || !draftGroup.name.trim()) return setError("Group name is required");
    if (draftGroup.enabled) {
      if (!Array.isArray(draftGroup.connectionIds) || draftGroup.connectionIds.length < 2) {
        return setError("An enabled group must contain at least 2 connections");
      }
      if (!draftGroup.session?.enabled && !draftGroup.weekly?.enabled) {
        return setError("An enabled group must have session or weekly staggering enabled");
      }
    }
    const exists = groups.some((g) => g.id === draftGroup.id);
    saveGroups(exists ? groups.map((g) => (g.id === draftGroup.id ? draftGroup : g)) : [...groups, draftGroup]);
  };

  const handleQuickToggleEnabled = (groupId, nextEnabled) => {
    if (!isLoaded) return;
    const g = groups.find((item) => item.id === groupId);
    if (!g) return;
    if (nextEnabled) {
      if (g.connectionIds.length < 2) return setError("Group must contain at least 2 connections before enabling");
      if (!g.session?.enabled && !g.weekly?.enabled) {
        return setError("Group must have session or weekly staggering enabled before activating");
      }
    }
    saveGroups(groups.map((item) => (item.id === groupId ? { ...item, enabled: nextEnabled } : item)));
  };

  const handleRemoveMember = (groupId, connIdToRemove) => {
    if (editingGroupId === groupId && draftGroup) {
      return setDraftGroup({ ...draftGroup, connectionIds: removeConnectionId(draftGroup.connectionIds, connIdToRemove) });
    }
    if (!isLoaded) return;
    saveGroups(groups.map((g) => (g.id === groupId ? { ...g, connectionIds: removeConnectionId(g.connectionIds, connIdToRemove) } : g)));
  };

  if (!loading && isLoaded && !visible) return null;

  const draftSelectedProviders = draftGroup
    ? Array.from(new Set(draftGroup.connectionIds.map((id) => connectionMap.get(id)?.provider).filter(Boolean)))
    : [];

  const draftHasAntigravity = draftSelectedProviders.includes("antigravity");
  const draftHasMixedDurations = draftSelectedProviders.length > 1;
  const draftSessionMembers = draftGroup ? resolvePolicyMemberIds(draftGroup, connections, "session") : [];
  const draftWeeklyMembers = draftGroup ? resolvePolicyMemberIds(draftGroup, connections, "weekly") : [];

  return (
    <Card padding="md" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-4 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary">splitscreen</span>
            <h3 className="text-base font-semibold text-text-primary">Quota Stagger Groups</h3>
            {isLoaded && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {groups.length} {groups.length === 1 ? "group" : "groups"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Stagger session and weekly quota reset windows across accounts using fractional phase offsets.
          </p>
        </div>

        {editingGroupId === null && isLoaded && (
          <button
            type="button"
            onClick={() => {
              const newG = createDefaultGroup(groups);
              setDraftGroup(newG);
              setEditingGroupId(newG.id);
              setError(null);
            }}
            disabled={saving}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>Create Stagger Group</span>
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isLoaded && (
              <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="underline hover:text-red-700">
                Retry
              </button>
            )}
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-text-muted hover:text-text-primary" aria-label="Dismiss error">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-300">
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
          <span>{successMessage}</span>
        </div>
      )}

      {editingGroupId !== null && draftGroup && (
        <div className="rounded-xl border border-primary/20 bg-black/[0.01] p-4 dark:bg-white/[0.01] space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-text-primary">
              {groups.some((g) => g.id === draftGroup.id) ? "Edit Stagger Group" : "New Stagger Group"}
            </h4>
            <span className="font-mono text-[11px] text-text-muted">ID: {draftGroup.id}</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Group Name</label>
              <input
                type="text"
                value={draftGroup.name}
                onChange={(e) => setDraftGroup({ ...draftGroup, name: e.target.value })}
                placeholder="e.g. Codex Stagger"
                className="w-full h-8 rounded-lg border border-black/10 bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-primary dark:border-white/10"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <Toggle
                checked={draftGroup.enabled}
                onChange={(next) => setDraftGroup({ ...draftGroup, enabled: next })}
                label="Group Enabled"
                description="Default OFF. Activation implies consent for auto-ping warmup."
                size="sm"
              />
              <Toggle
                checked={draftGroup.protectWindowStart}
                onChange={(next) => setDraftGroup({ ...draftGroup, protectWindowStart: next })}
                label="Protect Window Start"
                description="Blocks normal routed requests ONLY while known inactive window awaits reserved slot; external use cannot be controlled."
                size="sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-black/5 dark:border-white/5">
              <Toggle
                checked={draftGroup.session?.enabled ?? false}
                onChange={(next) => setDraftGroup({ ...draftGroup, session: { ...draftGroup.session, enabled: next } })}
                label="Session staggering"
                description="Staggers session quota reset windows using fractional phase offsets across members (typically 5 hours or provider-reported limit duration). Initial requests do not guarantee immediate window shifts."
                size="sm"
              />
              <Toggle
                checked={draftGroup.weekly?.enabled ?? false}
                onChange={(next) => setDraftGroup({ ...draftGroup, weekly: { ...draftGroup.weekly, enabled: next } })}
                label="Weekly staggering"
                description="Staggers weekly quota windows (typically 7 days) only when sliding resets are observed."
                size="sm"
              />
            </div>

            {draftGroup.session?.enabled && draftGroup.weekly?.enabled && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                When both session and weekly staggering are active, the later window deadline controls. This combined delay can defer an account from being used for multiple days. Protection blocks routed requests while awaiting reserved slots, and external traffic outside 9Router breaks phase alignment.
              </div>
            )}

            {draftHasAntigravity && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                Antigravity connections do not support auto-ping and cannot shift unknown model windows. Weekly staggering applies only when verified sliding.
              </div>
            )}

            {draftHasMixedDurations && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2.5 text-xs text-blue-700 dark:text-blue-300">
                Different window durations use per-provider index/N phase calculation; perpetual equal absolute gaps cannot be guaranteed across mismatched durations.
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-text-primary">
                  Selected Phase Order ({draftGroup.connectionIds.length} members)
                </label>
                <span className="text-[11px] text-text-muted">Stable order sets phase offset</span>
              </div>

              {draftGroup.connectionIds.length === 0 ? (
                <div className="rounded-lg border border-dashed border-black/15 p-4 text-center text-xs text-text-muted dark:border-white/15">
                  No connections selected. Check connections below to add them to this group.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {draftGroup.connectionIds.map((connId, index) => {
                    const conn = connectionMap.get(connId);
                    const isDeactivated = conn && conn.isActive === false;
                    const sessionOffset = getMemberPhaseOffset(connId, draftSessionMembers);
                    const weeklyOffset = getMemberPhaseOffset(connId, draftWeeklyMembers);

                    return (
                      <div key={connId} className="flex items-center justify-between gap-2 rounded-lg border border-black/10 bg-surface px-3 py-2 text-xs dark:border-white/10">
                        <div className="flex items-center gap-2 min-w-0">
                          {conn ? (
                            <>
                              <ProviderIcon
                                src={`/providers/${conn.provider}.png`}
                                alt={conn.provider}
                                size={20}
                                className="size-5 rounded object-contain shrink-0"
                                fallbackText={conn.provider?.slice(0, 2).toUpperCase()}
                              />
                              <span className="font-medium text-text-primary capitalize truncate">
                                {STAGGER_PROVIDERS[conn.provider]?.label || conn.provider}
                              </span>
                              <span className="text-text-muted truncate">{conn.name || conn.email || conn.displayName || conn.id}</span>
                              <div className="flex flex-wrap items-center gap-1 shrink-0">
                                {draftGroup.session?.enabled && (
                                  <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-text-primary dark:bg-white/5">
                                    Session: {sessionOffset ? `${sessionOffset.slot}/${sessionOffset.total} (${sessionOffset.pct}%)` : "Not scheduled"}
                                  </span>
                                )}
                                {draftGroup.weekly?.enabled && (
                                  <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-text-primary dark:bg-white/5">
                                    Weekly: {weeklyOffset ? `${weeklyOffset.slot}/${weeklyOffset.total} (${weeklyOffset.pct}%)` : "Not scheduled"}
                                  </span>
                                )}
                              </div>
                              {conn.provider === "antigravity" && (
                                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
                                  No auto-ping
                                </span>
                              )}
                              {isDeactivated && (
                                <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-500 shrink-0">
                                  Deactivated
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-amber-700 dark:text-amber-300">
                              Stale/Deleted: {connId}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setDraftGroup({ ...draftGroup, connectionIds: reorderConnectionIds(draftGroup.connectionIds, index, index - 1) })}
                            disabled={index === 0}
                            className="flex h-7 w-7 items-center justify-center rounded border border-black/10 text-text-muted hover:bg-black/5 hover:text-text-primary disabled:opacity-30 dark:border-white/10 dark:hover:bg-white/5"
                            title="Move phase earlier"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftGroup({ ...draftGroup, connectionIds: reorderConnectionIds(draftGroup.connectionIds, index, index + 1) })}
                            disabled={index === draftGroup.connectionIds.length - 1}
                            className="flex h-7 w-7 items-center justify-center rounded border border-black/10 text-text-muted hover:bg-black/5 hover:text-text-primary disabled:opacity-30 dark:border-white/10 dark:hover:bg-white/5"
                            title="Move phase later"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftGroup({ ...draftGroup, connectionIds: removeConnectionId(draftGroup.connectionIds, connId) })}
                            className="flex h-7 w-7 items-center justify-center rounded text-red-500 hover:bg-red-500/10"
                            title="Remove from group"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-2">
              <label className="block text-xs font-semibold text-text-primary mb-1.5">
                Select Supported OAuth Connections
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-black/10 p-2 dark:border-white/10">
                {eligibleConnections.length === 0 ? (
                  <p className="text-xs text-text-muted p-2">No active OAuth connections found for supported stagger providers.</p>
                ) : (
                  eligibleConnections.map((conn) => {
                    const isSelected = (draftGroup.connectionIds || []).includes(conn.id);
                    return (
                      <label
                        key={conn.id}
                        className={`flex items-center justify-between gap-2 rounded-lg p-2 text-xs transition-colors cursor-pointer ${
                          isSelected ? "bg-primary/5 text-text-primary" : "hover:bg-black/5 dark:hover:bg-white/5 text-text-muted"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const cur = draftGroup.connectionIds || [];
                              setDraftGroup({
                                ...draftGroup,
                                connectionIds: isSelected ? removeConnectionId(cur, conn.id) : [...cur, conn.id],
                              });
                            }}
                            className="rounded border-black/20 text-primary focus:ring-primary dark:border-white/20"
                          />
                          <ProviderIcon
                            src={`/providers/${conn.provider}.png`}
                            alt={conn.provider}
                            size={18}
                            className="size-[18px] rounded object-contain shrink-0"
                            fallbackText={conn.provider?.slice(0, 2).toUpperCase()}
                          />
                          <span className="font-medium capitalize text-text-primary">{STAGGER_PROVIDERS[conn.provider]?.label || conn.provider}</span>
                          <span className="truncate">{conn.name || conn.email || conn.displayName || conn.id}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {conn.provider === "antigravity" && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">No auto-ping</span>
                          )}
                          {conn.isActive === false && (
                            <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-500">Deactivated</span>
                          )}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-black/10 dark:border-white/10">
            <button
              type="button"
              onClick={() => {
                setDraftGroup(null);
                setEditingGroupId(null);
                setError(null);
              }}
              disabled={saving}
              className="h-8 rounded-lg border border-black/10 px-3 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Group</span>
              )}
            </button>
          </div>
        </div>
      )}

      {groups.length === 0 && editingGroupId === null && isLoaded && (
        <div className="rounded-xl border border-black/10 bg-black/[0.01] p-6 text-center dark:border-white/10 dark:bg-white/[0.01]">
          <span className="material-symbols-outlined text-[32px] text-text-muted opacity-40">styler</span>
          <h4 className="mt-2 text-sm font-semibold text-text-primary">No Stagger Groups Configured</h4>
          <p className="mt-1 text-xs text-text-muted max-w-sm mx-auto">
            Group multiple OAuth accounts to distribute reset windows evenly across time and keep continuous capacity available.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group) => {
            if (editingGroupId === group.id) return null;

            const memberConns = (group.connectionIds || []).map((id) => ({ id, conn: connectionMap.get(id) }));
            const staleCount = memberConns.filter((m) => !m.conn).length;
            const deactCount = memberConns.filter((m) => m.conn && m.conn.isActive === false).length;

            return (
              <div
                key={group.id}
                className={`rounded-xl border p-3.5 transition-colors ${
                  group.enabled ? "border-primary/30 bg-primary/[0.02]" : "border-black/10 bg-surface dark:border-white/10"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-text-primary truncate">{group.name}</h4>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          group.enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-surface-2 text-text-muted"
                        }`}
                      >
                        {group.enabled ? "Active" : "Disabled"}
                      </span>
                      {group.protectWindowStart && (
                        <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                          Protected
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span>{group.connectionIds.length} members</span>
                      <span>•</span>
                      <span>Session: {group.session?.enabled ? "On" : "Off"}</span>
                      <span>•</span>
                      <span>Weekly: {group.weekly?.enabled ? "On" : "Off"}</span>
                      {staleCount > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">• {staleCount} stale</span>}
                      {deactCount > 0 && <span className="text-red-500 font-medium">• {deactCount} deactivated</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Toggle
                      size="sm"
                      checked={group.enabled}
                      disabled={saving}
                      onChange={(next) => handleQuickToggleEnabled(group.id, next)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setDraftGroup(JSON.parse(JSON.stringify(group)));
                        setEditingGroupId(group.id);
                        setError(null);
                      }}
                      disabled={saving}
                      className="flex h-8 items-center gap-1 rounded-lg border border-black/10 px-2.5 text-xs text-text-primary transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                    >
                      <span className="material-symbols-outlined text-[15px]">edit</span>
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => saveGroups(groups.filter((g) => g.id !== group.id))}
                      disabled={saving}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                      title="Delete stagger group"
                    >
                      <span className="material-symbols-outlined text-[17px]">delete</span>
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-black/5 pt-2.5 dark:border-white/5">
                  {memberConns.map(({ id, conn }, idx) => (
                    <div
                      key={id}
                      className="flex items-center gap-1.5 rounded-md border border-black/10 bg-black/[0.02] px-2 py-1 text-xs dark:border-white/10 dark:bg-white/[0.02]"
                    >
                      <span className="font-mono text-[10px] text-text-muted">#{idx + 1}</span>
                      {conn ? (
                        <>
                          <ProviderIcon
                            src={`/providers/${conn.provider}.png`}
                            alt={conn.provider}
                            size={16}
                            className="size-4 rounded object-contain shrink-0"
                            fallbackText={conn.provider?.slice(0, 2).toUpperCase()}
                          />
                          <span className="truncate max-w-[140px] text-text-primary">{conn.name || conn.email || conn.displayName || conn.id}</span>
                        </>
                      ) : (
                        <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{id} (stale)</span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(group.id, id)}
                        disabled={saving}
                        className="text-text-muted hover:text-red-500 ml-0.5"
                        title="Remove member"
                      >
                        <span className="material-symbols-outlined text-[13px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
