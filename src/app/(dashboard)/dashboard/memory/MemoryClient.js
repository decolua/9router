"use client";

import { useState, useEffect } from "react";
import { Card, Toggle } from "@/shared/components";

export default function MemoryClient() {
  const [memoryToolPruningEnabled, setMemoryToolPruningEnabled] = useState(false);
  const [memoryMaxToolTurnsKeepFull, setMemoryMaxToolTurnsKeepFull] = useState(2);
  const [memoryMaxHistoricalToolChars, setMemoryMaxHistoricalToolChars] = useState(4000);
  const [memoryMediaPruningEnabled, setMemoryMediaPruningEnabled] = useState(false);
  const [memoryCompactionEnabled, setMemoryCompactionEnabled] = useState(false);
  const [memoryCompactionThresholdTokens, setMemoryCompactionThresholdTokens] = useState(128000);
  const [memoryRecentTurnsToKeep, setMemoryRecentTurnsToKeep] = useState(8);
  const [memoryCacheAnchorEnabled, setMemoryCacheAnchorEnabled] = useState(true);
  const [memoryHandoffEnabled, setMemoryHandoffEnabled] = useState(false);

  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating memory setting:", error);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setMemoryToolPruningEnabled(!!data.memoryToolPruningEnabled);
          if (typeof data.memoryMaxToolTurnsKeepFull === "number") setMemoryMaxToolTurnsKeepFull(data.memoryMaxToolTurnsKeepFull);
          if (typeof data.memoryMaxHistoricalToolChars === "number") setMemoryMaxHistoricalToolChars(data.memoryMaxHistoricalToolChars);
          setMemoryMediaPruningEnabled(!!data.memoryMediaPruningEnabled);
          setMemoryCompactionEnabled(!!data.memoryCompactionEnabled);
          if (typeof data.memoryCompactionThresholdTokens === "number") setMemoryCompactionThresholdTokens(data.memoryCompactionThresholdTokens);
          if (typeof data.memoryRecentTurnsToKeep === "number") setMemoryRecentTurnsToKeep(data.memoryRecentTurnsToKeep);
          setMemoryCacheAnchorEnabled(data.memoryCacheAnchorEnabled !== false);
          setMemoryHandoffEnabled(!!data.memoryHandoffEnabled);
        }
      } catch (err) {
        console.error("Failed to load memory settings:", err);
      }
    };
    loadSettings();
  }, []);

  const handleMemoryToolPruning = (value) => {
    setMemoryToolPruningEnabled(value);
    patchSetting({ memoryToolPruningEnabled: value });
  };

  const handleMemoryMediaPruning = (value) => {
    setMemoryMediaPruningEnabled(value);
    patchSetting({ memoryMediaPruningEnabled: value });
  };

  const handleMemoryCompaction = (value) => {
    setMemoryCompactionEnabled(value);
    patchSetting({ memoryCompactionEnabled: value });
  };

  const handleMemoryCacheAnchor = (value) => {
    setMemoryCacheAnchorEnabled(value);
    patchSetting({ memoryCacheAnchorEnabled: value });
  };

  const handleMemoryHandoff = (value) => {
    setMemoryHandoffEnabled(value);
    patchSetting({ memoryHandoffEnabled: value });
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl text-primary">
            psychology
          </span>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              AI Memory & Context Management
            </h1>
            <p className="text-sm text-text-muted">
              Bounded observation lifecycle and token reduction pipeline inspired by{" "}
              <a
                href="https://github.com/akitaonrails/ai-memory"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline hover:opacity-80"
              >
                ai-memory
              </a>
              . Keeps conversations coherent while slashing token costs by 40%–80%.
            </p>
          </div>
        </div>
      </div>

      {/* Phase 1: Tool Output Pruning */}
      <Card id="tool-pruning">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">build_circle</span>
            <h2 className="text-lg font-semibold">Historical Tool Output Pruning</h2>
          </div>
          <Toggle checked={memoryToolPruningEnabled} onChange={handleMemoryToolPruning} />
        </div>
        <p className="text-sm text-text-muted mb-4">
          In multi-turn coding sessions (Claude Code, Cline, Roo, Codex), historical tool outputs (file reads, build logs, git diffs) dominate 70–85% of input tokens. This prunes older turns while keeping recent turns intact.
        </p>

        {memoryToolPruningEnabled && (
          <div className="bg-surface-2 p-4 rounded-lg border border-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Keep Recent Tool Turns Full
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={memoryMaxToolTurnsKeepFull}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value, 10) || 2);
                  setMemoryMaxToolTurnsKeepFull(val);
                  patchSetting({ memoryMaxToolTurnsKeepFull: val });
                }}
                className="w-full rounded border border-border bg-surface px-3 py-1.5 font-mono text-sm"
              />
              <span className="text-xs text-text-muted mt-1 block">
                The most recent {memoryMaxToolTurnsKeepFull} tool results will never be truncated.
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Max Historical Output Length (chars)
              </label>
              <input
                type="number"
                min="100"
                max="16000"
                step="500"
                value={memoryMaxHistoricalToolChars}
                onChange={(e) => {
                  const val = Math.max(100, parseInt(e.target.value, 10) || 4000);
                  setMemoryMaxHistoricalToolChars(val);
                  patchSetting({ memoryMaxHistoricalToolChars: val });
                }}
                className="w-full rounded border border-border bg-surface px-3 py-1.5 font-mono text-sm"
              />
              <span className="text-xs text-text-muted mt-1 block">
                Older tool turns beyond recent window are bounded to {memoryMaxHistoricalToolChars} chars.
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Phase 1: Media Pruning */}
      <Card id="media-pruning">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">image</span>
            <h2 className="text-lg font-semibold">Historical Media & Attachment Pruning</h2>
          </div>
          <Toggle checked={memoryMediaPruningEnabled} onChange={handleMemoryMediaPruning} />
        </div>
        <p className="text-sm text-text-muted">
          Replaces heavy Base64 image and audio payloads in older answered turns with lightweight references (`[Historical media omitted by 9router]`), preserving full media exclusively in the current active user turn.
        </p>
      </Card>

      {/* Phase 2: Sliding Window Compaction */}
      <Card id="compaction">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">compress</span>
            <h2 className="text-lg font-semibold">Sliding Window Context Compaction</h2>
          </div>
          <Toggle checked={memoryCompactionEnabled} onChange={handleMemoryCompaction} />
        </div>
        <p className="text-sm text-text-muted mb-4">
          When a conversation spans dozens of turns, older messages (turns 1 to N-K) are consolidated into a structured summary block, preventing context limit exhaustion.
        </p>

        {memoryCompactionEnabled && (
          <div className="bg-surface-2 p-4 rounded-lg border border-border grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Compaction Token Threshold
              </label>
              <input
                type="number"
                min="4000"
                max="512000"
                step="8000"
                value={memoryCompactionThresholdTokens}
                onChange={(e) => {
                  const val = Math.max(4000, parseInt(e.target.value, 10) || 128000);
                  setMemoryCompactionThresholdTokens(val);
                  patchSetting({ memoryCompactionThresholdTokens: val });
                }}
                className="w-full rounded border border-border bg-surface px-3 py-1.5 font-mono text-sm"
              />
              <span className="text-xs text-text-muted mt-1 block">
                Trigger compaction only when estimated history exceeds {memoryCompactionThresholdTokens.toLocaleString()} tokens.
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Recent Turns to Keep Intact
              </label>
              <input
                type="number"
                min="2"
                max="30"
                value={memoryRecentTurnsToKeep}
                onChange={(e) => {
                  const val = Math.max(2, parseInt(e.target.value, 10) || 8);
                  setMemoryRecentTurnsToKeep(val);
                  patchSetting({ memoryRecentTurnsToKeep: val });
                }}
                className="w-full rounded border border-border bg-surface px-3 py-1.5 font-mono text-sm"
              />
              <span className="text-xs text-text-muted mt-1 block">
                The latest {memoryRecentTurnsToKeep} conversation turns will remain uncompacted.
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Phase 3: Prompt Cache Anchoring */}
      <Card id="cache-anchor">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">anchor</span>
            <h2 className="text-lg font-semibold">Prompt Cache Breakpoint Anchoring</h2>
          </div>
          <Toggle checked={memoryCacheAnchorEnabled} onChange={handleMemoryCacheAnchor} />
        </div>
        <p className="text-sm text-text-muted">
          Deterministically anchors `cache_control: {"{ \"type\": \"ephemeral\" }"}` on system instructions and tool definitions for Anthropic Claude and compatible providers. Maximizes prompt cache hit rates and cuts token costs by up to 90%.
        </p>
      </Card>

      {/* Phase 4: Cross-Session Handoff Store */}
      <Card id="handoff">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">sync_alt</span>
            <h2 className="text-lg font-semibold">Cross-Session Handoff Continuity</h2>
          </div>
          <Toggle checked={memoryHandoffEnabled} onChange={handleMemoryHandoff} />
        </div>
        <p className="text-sm text-text-muted">
          Maintains a bounded project handoff store across CLI agent switches (e.g. Claude Code → Codex → Cline) in the same directory, automatically injecting the previous session handoff summary into the new session.
        </p>
      </Card>
    </div>
  );
}
