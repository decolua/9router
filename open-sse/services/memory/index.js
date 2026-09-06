/**
 * 9Router AI Memory & Token Optimization Service
 *
 * Modular pipeline integrating:
 * - Phase 1: Tool Output Pruning & Historical Media Pruning
 * - Phase 2: Sliding Window Context Compaction
 * - Phase 3: Prompt Cache Breakpoint Anchoring
 * - Phase 4: Cross-Session Handoff Injection
 */

import { pruneHistoricalTools } from "./toolPruner.js";
import { pruneHistoricalMedia } from "./mediaPruner.js";
import { compactContextWindow } from "./contextCompactor.js";
import { anchorPromptCache } from "./cacheAnchor.js";
import { injectPendingHandoff } from "./handoffStore.js";

/**
 * Apply all enabled memory enhancements to a request body in sequence
 * @param {Object} body - Request body
 * @param {Object} options
 * @param {Object} [options.settings] - 9router settings object (from localDb)
 * @param {string} [options.targetFormat] - Target provider format
 * @param {string} [options.projectKey] - Optional project key for handoffs
 * @param {Object} [options.log] - Logger instance
 * @returns {Promise<{ body: Object, stats: Object }>}
 */
export async function applyMemoryEnhancements(body, options = {}) {
  const { settings = {}, targetFormat = "openai", projectKey, log } = options;

  const stats = {
    toolPruning: { applied: false, savedChars: 0 },
    mediaPruning: { applied: false, savedItems: 0 },
    compaction: { applied: false, savedTokens: 0 },
    cacheAnchor: { applied: false },
    handoff: { applied: false },
  };

  if (!body || typeof body !== "object") {
    return { body, stats };
  }

  // 1. Phase 4: Pending Handoff Injection (if enabled)
  if (settings.memoryHandoffEnabled) {
    const handoffRes = injectPendingHandoff(body, {
      enabled: true,
      projectKey,
    });
    if (handoffRes.injected) {
      stats.handoff.applied = true;
      log?.debug?.("MEMORY", `Injected previous session handoff for project: ${projectKey}`);
    }
  }

  // 2. Phase 1: Historical Media Pruning (default: disabled, opt-in)
  const mediaPruningEnabled = settings.memoryMediaPruningEnabled === true;
  if (mediaPruningEnabled) {
    const mediaRes = pruneHistoricalMedia(body, { enabled: true });
    if (mediaRes.pruned) {
      stats.mediaPruning = { applied: true, savedItems: mediaRes.savedItems };
      log?.debug?.("MEMORY", `Pruned ${mediaRes.savedItems} historical media items`);
    }
  }

  // 3. Phase 1: Historical Tool Output Pruning (default: disabled, opt-in)
  const toolPruningEnabled = settings.memoryToolPruningEnabled === true;
  if (toolPruningEnabled) {
    const toolRes = pruneHistoricalTools(body, {
      enabled: true,
      keepRecentTurns: settings.memoryMaxToolTurnsKeepFull ?? 2,
      maxHistoricalChars: settings.memoryMaxHistoricalToolChars ?? 4000,
    });
    if (toolRes.pruned) {
      stats.toolPruning = { applied: true, savedChars: toolRes.savedChars };
      log?.info?.("MEMORY", `Tool Pruner saved ~${Math.round(toolRes.savedChars / 4)} tokens across ${toolRes.count} historical tool turns`);
    }
  }

  // 4. Phase 2: Sliding Window Context Compaction (default: disabled, opt-in)
  if (settings.memoryCompactionEnabled === true) {
    const compactRes = compactContextWindow(body, {
      enabled: true,
      thresholdTokens: settings.memoryCompactionThresholdTokens ?? 128000,
      recentTurnsToKeep: settings.memoryRecentTurnsToKeep ?? 8,
    });
    if (compactRes.compacted) {
      stats.compaction = { applied: true, savedTokens: compactRes.savedTokens };
      log?.info?.("MEMORY", `Context Compactor reduced prompt from ~${compactRes.originalTokens} to ~${compactRes.newTokens} tokens`);
    }
  }

  // 5. Phase 3: Prompt Cache Breakpoint Anchoring (default: enabled if not set to false)
  const cacheAnchorEnabled = settings.memoryCacheAnchorEnabled !== false;
  if (cacheAnchorEnabled) {
    const cacheRes = anchorPromptCache(body, {
      enabled: true,
      format: targetFormat,
    });
    if (cacheRes.anchored) {
      stats.cacheAnchor.applied = true;
    }
  }

  return { body, stats };
}

export * from "./toolPruner.js";
export * from "./mediaPruner.js";
export * from "./contextCompactor.js";
export * from "./cacheAnchor.js";
export * from "./handoffStore.js";
