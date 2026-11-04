"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";

/**
 * Bulk-refresh model lists for selected providers with aihot.news leaderboard filtering.
 *
 * When filterByLeaderboard is enabled:
 * 1. Fetches/refreshes the latest models across all aihot.news leaderboard tables before syncing.
 * 2. Confirmed high-performance models on the leaderboard are automatically kept.
 * 3. Obvious low-tier/obsolete models are automatically discarded.
 * 4. Models with ambiguous or unverified names are surfaced in a review panel for
 *    the user to decide. Decisions are permanently remembered in SQLite KV so they
 *    never need to be reviewed again.
 */
export default function SyncModelsModal({ isOpen, onClose, onSynced }) {
  const [providers, setProviders] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({});
  const [currentProvider, setCurrentProvider] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Leaderboard filter & memory states
  const [filterByLeaderboard, setFilterByLeaderboard] = useState(true);
  const [leaderboardInfo, setLeaderboardInfo] = useState(null);
  const [rememberedCount, setRememberedCount] = useState(0);

  // Pending review items from sync run
  const [pendingReviews, setPendingReviews] = useState([]);
  const [reviewChoices, setReviewChoices] = useState({});
  const [submittingReviews, setSubmittingReviews] = useState(false);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState(null);

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/providers/sync-models", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data?.error || "Failed to load providers");
        return;
      }
      setProviders(data.providers || []);
      if (data.leaderboard) setLeaderboardInfo(data.leaderboard);
      if (typeof data.rememberedDecisionsCount === "number") {
        setRememberedCount(data.rememberedDecisionsCount);
      }
    } catch (error) {
      setLoadError(String(error?.message || error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchInitialData();
  }, [isOpen, fetchInitialData]);

  // Reset per-run state whenever the modal is reopened
  useEffect(() => {
    if (isOpen) return;
    setResults({});
    setCurrentProvider(null);
    setSelected(new Set());
    setPendingReviews([]);
    setReviewChoices({});
    setReviewSuccessMsg(null);
  }, [isOpen]);

  const displayName = useCallback(
    (providerId) => AI_PROVIDERS[providerId]?.name || providerId,
    [],
  );

  const allSelected = providers.length > 0 && selected.size === providers.length;

  const toggle = (providerId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(providers.map((p) => p.provider)));
  };

  const run = async () => {
    if (running || selected.size === 0) return;
    setRunning(true);
    setResults({});
    setPendingReviews([]);
    setReviewChoices({});
    setReviewSuccessMsg(null);

    const queue = providers.map((p) => p.provider).filter((id) => selected.has(id));
    const accumulatedReviews = [];

    // First provider forces fresh leaderboard refresh so it only fetches once per batch
    let forceLeaderboard = true;

    for (const providerId of queue) {
      setCurrentProvider(providerId);
      try {
        const res = await fetch("/api/providers/sync-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providers: [providerId],
            filterByLeaderboard,
            forceRefreshLeaderboard: forceLeaderboard,
          }),
        });
        forceLeaderboard = false;
        const data = await res.json();
        const entry = data?.results?.[0] || {
          ok: false,
          error: data?.error || `HTTP ${res.status}`,
        };
        setResults((prev) => ({ ...prev, [providerId]: entry }));

        if (data?.leaderboard) setLeaderboardInfo(data.leaderboard);

        if (Array.isArray(entry.pendingReview) && entry.pendingReview.length > 0) {
          accumulatedReviews.push(...entry.pendingReview);
        }
      } catch (error) {
        setResults((prev) => ({
          ...prev,
          [providerId]: { ok: false, error: String(error?.message || error) },
        }));
      }
    }

    if (accumulatedReviews.length > 0) {
      setPendingReviews(accumulatedReviews);
      // Initialize choices: default to 'keep'
      const initialChoices = {};
      for (const item of accumulatedReviews) {
        initialChoices[item.id] = "keep";
      }
      setReviewChoices(initialChoices);
    }

    setCurrentProvider(null);
    setRunning(false);
    if (typeof onSynced === "function") onSynced();
  };

  const handleSetChoice = (id, choice) => {
    setReviewChoices((prev) => ({ ...prev, [id]: choice }));
  };

  const handleSelectAllChoices = (choice) => {
    const updated = {};
    for (const item of pendingReviews) {
      updated[item.id] = choice;
    }
    setReviewChoices(updated);
  };

  const handleSubmitReviews = async () => {
    if (submittingReviews || pendingReviews.length === 0) return;
    setSubmittingReviews(true);
    setReviewSuccessMsg(null);
    try {
      const payload = pendingReviews.map((item) => ({
        providerAlias: item.providerAlias || item.provider,
        id: item.id,
        name: item.name,
        action: reviewChoices[item.id] || "keep",
      }));

      const res = await fetch("/api/providers/sync-models/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save decisions");

      const keptCount = payload.filter((p) => p.action === "keep").length;
      const rejectedCount = payload.filter((p) => p.action === "reject").length;

      setReviewSuccessMsg(
        `已成功处理：保留并添加 ${keptCount} 个模型，排除 ${rejectedCount} 个模型。选择已全部记住！`,
      );
      setRememberedCount((c) => c + payload.length);
      setPendingReviews([]);

      if (typeof onSynced === "function") onSynced();
    } catch (err) {
      setReviewSuccessMsg(`保存失败: ${err.message}`);
    } finally {
      setSubmittingReviews(false);
    }
  };

  const handleClearDecisions = async () => {
    if (!window.confirm("确定清除所有已记住的手动筛选决策吗？下次更新时将重新对不确定的模型进行提示。")) {
      return;
    }
    try {
      await fetch("/api/providers/sync-models/decisions", { method: "DELETE" });
      setRememberedCount(0);
      alert("已清除所有记住的筛选决策");
    } catch (err) {
      alert(`清除失败: ${err.message}`);
    }
  };

  const totalAdded = useMemo(
    () => Object.values(results).reduce((sum, r) => sum + (r?.added || 0), 0),
    [results],
  );
  const totalFiltered = useMemo(
    () => Object.values(results).reduce((sum, r) => sum + (r?.skippedFiltered || 0), 0),
    [results],
  );
  const doneCount = Object.keys(results).length;

  return (
    <Modal isOpen={isOpen} onClose={running ? () => {} : onClose} title="Update model lists" size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">
          从选定供应商实时获取最新模型列表。开启排行榜筛选后，将自动剔除低性能及过时模型。
        </p>

        {/* aihot.news Leaderboard Filter Switch & Status Card */}
        <div className="flex flex-col gap-1.5 p-2 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-lg">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <label className="flex items-center gap-2 text-xs font-semibold text-text-main hover:cursor-pointer">
              <input
                type="checkbox"
                checked={filterByLeaderboard}
                onChange={(e) => setFilterByLeaderboard(e.target.checked)}
                disabled={running}
                className="accent-primary hover:cursor-pointer rounded"
              />
              <span>只保留 aihot.news 排行榜及各子表模型 (推荐)</span>
            </label>

            {leaderboardInfo && leaderboardInfo.count > 0 && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-medium">
                已收录 {leaderboardInfo.count} 款顶级模型
                {leaderboardInfo.fetchedAt && ` · ${new Date(leaderboardInfo.fetchedAt).toLocaleDateString()}`}
              </span>
            )}
          </div>

          <div className="text-[10px] text-text-muted flex items-center justify-between flex-wrap gap-1">
            <span>
              更新前实时抓取最新主榜与子榜；过滤低性能模型，无法确定的模型供您核对，选择自动永久记忆。
            </span>
            {rememberedCount > 0 && (
              <button
                type="button"
                onClick={handleClearDecisions}
                className="text-text-muted hover:text-amber-500 hover:underline hover:cursor-pointer text-[10px]"
                title="点击清除手动记忆"
              >
                已记住 {rememberedCount} 条决策 (清除)
              </button>
            )}
          </div>
        </div>

        {loadError && (
          <div className="text-xs text-red-500 border border-red-500/30 rounded p-2">{loadError}</div>
        )}

        {loading ? (
          <div className="text-sm text-text-muted py-4">Loading providers…</div>
        ) : providers.length === 0 ? (
          <div className="text-sm text-text-muted py-4">
            No providers with an active connection support live model listing.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <label className="flex items-center gap-2 text-xs font-medium hover:cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={running}
                  className="accent-primary hover:cursor-pointer"
                />
                Select all ({providers.length})
              </label>
              <span className="text-[11px] text-text-muted">
                {selected.size} selected
                {doneCount > 0 && ` · ${doneCount} done · +${totalAdded} added`}
                {totalFiltered > 0 && ` · ${totalFiltered} filtered out`}
              </span>
            </div>

            <div className="max-h-[220px] overflow-y-auto flex flex-col gap-0.5 border border-border/50 rounded p-1">
              {providers.map((entry) => {
                const result = results[entry.provider];
                const isCurrent = currentProvider === entry.provider;
                return (
                  <label
                    key={entry.provider}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-primary/5 hover:cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(entry.provider)}
                      onChange={() => toggle(entry.provider)}
                      disabled={running}
                      className="accent-primary hover:cursor-pointer"
                    />
                    <ProviderIcon provider={entry.provider} className="w-4 h-4" />
                    <span className="text-text-main truncate max-w-[140px] font-medium">
                      {displayName(entry.provider)}
                    </span>
                    {entry.isCustom && (
                      <span className="text-[9px] text-text-muted border border-border rounded px-1">custom</span>
                    )}
                    <span className="text-[10px] text-text-muted">
                      {entry.activeConnections} active
                    </span>

                    <span className="ml-auto text-[10px]">
                      {isCurrent ? (
                        <span className="text-primary font-medium animate-pulse">syncing…</span>
                      ) : result ? (
                        result.ok ? (
                          <span className="text-emerald-500 font-medium">
                            +{result.added} new
                            {result.skippedFiltered > 0 && (
                              <span
                                className="text-amber-500/90 ml-1"
                                title={`${result.skippedFiltered} models filtered out (not in aihot leaderboard)`}
                              >
                                · {result.skippedFiltered} filtered
                              </span>
                            )}
                            {Array.isArray(result.pendingReview) && result.pendingReview.length > 0 && (
                              <span
                                className="text-blue-500 ml-1 font-medium"
                                title={`${result.pendingReview.length} models need review`}
                              >
                                · {result.pendingReview.length} 待确认
                              </span>
                            )}
                            {result.skippedNonChat > 0 && (
                              <span
                                className="text-text-muted ml-1"
                                title={`${result.skippedNonChat} non-chat entries skipped`}
                              >
                                ({result.skippedNonChat} non-chat)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-red-500 truncate max-w-[180px] inline-block align-bottom" title={result.error}>
                            {result.error}
                          </span>
                        )
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {/* Review Section for Uncertain Models */}
        {pendingReviews.length > 0 && (
          <div className="flex flex-col gap-2 p-2.5 bg-surface border border-amber-500/30 rounded-lg">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                <span className="material-symbols-outlined text-[16px]">help</span>
                <span>发现 {pendingReviews.length} 款名称与排行榜存在差异的模型，请确认是否保留：</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleSelectAllChoices("keep")}
                  className="px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 hover:cursor-pointer"
                >
                  全部保留
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAllChoices("reject")}
                  className="px-2 py-0.5 rounded border border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:cursor-pointer"
                >
                  全部排除
                </button>
              </div>
            </div>

            <p className="text-[11px] text-text-muted">
              这些模型与排行榜模型名称接近但无法100%确定。您的每一次选择都会被自动保存到记忆中，下次同步同名模型将自动执行，无需重复确认。
            </p>

            <div className="max-h-[200px] overflow-y-auto flex flex-col gap-1 pr-1">
              {pendingReviews.map((item) => {
                const choice = reviewChoices[item.id] || "keep";
                return (
                  <div
                    key={`${item.provider}-${item.id}`}
                    className="flex items-center justify-between gap-2 p-1.5 rounded bg-black/5 dark:bg-white/5 text-xs"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <ProviderIcon provider={item.provider} className="w-3.5 h-3.5 flex-shrink-0" />
                      <div className="flex flex-col truncate">
                        <span className="font-mono text-[11px] truncate">{item.id}</span>
                        {item.candidate && (
                          <span className="text-[10px] text-text-muted truncate">
                            疑似: {item.candidate.name} ({Math.round((item.score || 0) * 100)}% 相似)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSetChoice(item.id, "keep")}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:cursor-pointer ${
                          choice === "keep"
                            ? "bg-emerald-500 text-white"
                            : "border border-border text-text-muted hover:border-emerald-500 hover:text-emerald-500"
                        }`}
                      >
                        保留
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetChoice(item.id, "reject")}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:cursor-pointer ${
                          choice === "reject"
                            ? "bg-amber-500 text-white"
                            : "border border-border text-text-muted hover:border-amber-500 hover:text-amber-500"
                        }`}
                      >
                        排除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                variant="primary"
                onClick={handleSubmitReviews}
                disabled={submittingReviews}
                icon="save"
              >
                {submittingReviews ? "保存中…" : "确认并存入记忆"}
              </Button>
            </div>
          </div>
        )}

        {reviewSuccessMsg && (
          <div className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 p-2 rounded">
            {reviewSuccessMsg}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1 border-t border-border">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={running}>
            {doneCount > 0 && !running ? "Done" : "Cancel"}
          </Button>
          <Button
            size="sm"
            icon="sync"
            onClick={run}
            disabled={running || selected.size === 0}
          >
            {running
              ? `Updating ${doneCount}/${selected.size}…`
              : `Update ${selected.size || ""} selected`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

SyncModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSynced: PropTypes.func,
};
