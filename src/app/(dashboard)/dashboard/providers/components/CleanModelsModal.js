"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";

/**
 * Modal to screen and clean non-leaderboard models from 9Router's total custom model library.
 *
 * Keeps only models appearing on https://aihot.news/leaderboard and its category sub-boards,
 * purging obsolete, low-performance, or legacy models from the local database.
 */
export default function CleanModelsModal({ isOpen, onClose, onCleaned }) {
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [resultMsg, setResultMsg] = useState(null);

  // User decisions for uncertain models in the clean preview
  const [uncertainChoices, setUncertainChoices] = useState({});

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setResultMsg(null);
    try {
      const res = await fetch("/api/models/cleanup-non-leaderboard", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load cleanup preview");
      setPreview(data);

      const initial = {};
      for (const item of data.uncertainList || []) {
        initial[item.id] = "reject"; // default to reject non-verified
      }
      setUncertainChoices(initial);
    } catch (err) {
      setLoadError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchPreview();
  }, [isOpen, fetchPreview]);

  const handleExecuteClean = async () => {
    if (cleaning) return;
    setCleaning(true);
    setResultMsg(null);
    try {
      const decisions = Object.entries(uncertainChoices).map(([id, action]) => ({
        id,
        action,
      }));

      const res = await fetch("/api/models/cleanup-non-leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions, preserveUncertain: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cleanup failed");

      setResultMsg(data.message || `成功清理 ${data.deletedCount} 款非榜单模型！`);
      if (typeof onCleaned === "function") onCleaned();
      // Refresh preview to show updated state
      await fetchPreview();
    } catch (err) {
      setResultMsg(`清理失败: ${err.message}`);
    } finally {
      setCleaning(false);
    }
  };

  const handleToggleUncertain = (id, choice) => {
    setUncertainChoices((prev) => ({ ...prev, [id]: choice }));
  };

  return (
    <Modal isOpen={isOpen} onClose={cleaning ? () => {} : onClose} title="清理总库非榜单模型" size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">
          对照 <a href="https://aihot.news/leaderboard" target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">aihot.news 大模型排行榜</a> 全榜名单，一键清除总库中堆积的历史低性能、测试或过时模型，只留存顶级大模型。
        </p>

        {loadError && (
          <div className="text-xs text-red-500 border border-red-500/30 rounded p-2">{loadError}</div>
        )}

        {loading ? (
          <div className="text-sm text-text-muted py-6 text-center animate-pulse">
            正在分析总库模型与排行榜对照情况…
          </div>
        ) : preview ? (
          <div className="flex flex-col gap-3">
            {/* Summary statistics cards */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-lg border border-border bg-surface flex flex-col">
                <span className="text-lg font-bold text-text-main">{preview.totalCustomModels}</span>
                <span className="text-[11px] text-text-muted">总库自定义模型</span>
              </div>
              <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 flex flex-col">
                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{preview.keepCount}</span>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">在榜模型 (将保留)</span>
              </div>
              <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/5 flex flex-col">
                <span className="text-lg font-bold text-red-500">{preview.toDeleteCount}</span>
                <span className="text-[11px] text-red-500 font-medium">非榜单模型 (将清除)</span>
              </div>
            </div>

            {preview.toDeleteCount > 0 ? (
              <div className="p-2.5 border border-amber-500/20 bg-amber-500/5 rounded-lg text-xs text-text-muted flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold text-xs">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  <span>发现 {preview.toDeleteCount} 款不在 aihot.news 榜单上的模型</span>
                </div>
                <p className="text-[11px]">
                  包括旧代版本（如 gpt-3.5、gpt-4o、claude-3、gemini-1.5、llama-3 等）及历史同步遗留的测试/小模型。清理后，您的模型总表将极度纯净，仅剩顶级大模型。
                </p>
                {preview.toDeleteSample?.length > 0 && (
                  <div className="text-[10px] font-mono text-text-muted/80 mt-1 truncate">
                    部分待清理示例: {preview.toDeleteSample.slice(0, 6).map((s) => s.id).join(", ")}…
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 border border-emerald-500/30 bg-emerald-500/10 rounded-lg text-xs text-emerald-600 dark:text-emerald-400 text-center font-medium">
                太棒了！当前总库中的模型全部符合 aihot.news 排行榜，没有冗余的非榜单模型。
              </div>
            )}

            {/* Uncertain list if any */}
            {preview.uncertainCount > 0 && (
              <div className="flex flex-col gap-1.5 p-2 border border-border rounded-lg bg-surface">
                <span className="text-xs font-semibold text-text-main">
                  存在 {preview.uncertainCount} 款存疑变体模型（请选择是否破例保留）：
                </span>
                <div className="max-h-[140px] overflow-y-auto flex flex-col gap-1">
                  {preview.uncertainList.map((item) => {
                    const choice = uncertainChoices[item.id] || "reject";
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-2 p-1.5 rounded bg-black/5 dark:bg-white/5 text-xs"
                      >
                        <div className="flex flex-col truncate">
                          <span className="font-mono text-[11px] truncate">{item.id}</span>
                          {item.candidate && (
                            <span className="text-[10px] text-text-muted truncate">
                              疑似: {item.candidate.name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleUncertain(item.id, "keep")}
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
                            onClick={() => handleToggleUncertain(item.id, "reject")}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:cursor-pointer ${
                              choice === "reject"
                                ? "bg-red-500 text-white"
                                : "border border-border text-text-muted hover:border-red-500 hover:text-red-500"
                            }`}
                          >
                            清除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {resultMsg && (
              <div className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded font-medium">
                {resultMsg}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={cleaning}>
            关闭
          </Button>
          {preview && preview.toDeleteCount > 0 && (
            <Button
              size="sm"
              variant="danger"
              icon="delete_sweep"
              onClick={handleExecuteClean}
              disabled={cleaning}
            >
              {cleaning ? "正在清理中…" : `一键清理 ${preview.toDeleteCount} 款非榜单模型`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

CleanModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCleaned: PropTypes.func,
};
