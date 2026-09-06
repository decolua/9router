const api = require("../api/client");
const { pause } = require("../utils/input");
const { showStatus } = require("../utils/display");
const { showMenuWithBack } = require("../utils/menuHelper");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m"
};

/**
 * Show AI Memory & Context Optimization menu
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showMemoryMenu(breadcrumb = []) {
  await showMenuWithBack({
    title: "🧠  AI Memory & Context Management",
    breadcrumb,
    headerContent: async (data) => {
      const settings = data?.settings || {};
      const lines = [];

      const toolOn = settings.memoryToolPruningEnabled === true;
      const mediaOn = settings.memoryMediaPruningEnabled === true;
      const compactOn = settings.memoryCompactionEnabled === true;
      const cacheOn = settings.memoryCacheAnchorEnabled !== false;
      const handoffOn = settings.memoryHandoffEnabled === true;

      lines.push(`  Tool Pruner:     ${toolOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(keep ${settings.memoryMaxToolTurnsKeepFull ?? 2} recent turns, max ${settings.memoryMaxHistoricalToolChars ?? 4000} chars)${COLORS.reset}`);
      lines.push(`  Media Pruner:    ${mediaOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(prune old base64 images/audio)${COLORS.reset}`);
      lines.push(`  Context Compact: ${compactOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(threshold: ${settings.memoryCompactionThresholdTokens ?? 128000} tokens)${COLORS.reset}`);
      lines.push(`  Cache Anchor:    ${cacheOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(Anthropic / Gemini prompt cache)${COLORS.reset}`);
      lines.push(`  Handoff Store:   ${handoffOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(cross-agent session continuity)${COLORS.reset}`);

      return lines.join("\n");
    },
    refresh: async () => {
      const settingsRes = await api.getSettings();
      return {
        settings: settingsRes.success ? (settingsRes.data || {}) : {}
      };
    },
    items: [
      {
        label: (d) => {
          const on = d?.settings?.memoryToolPruningEnabled === true;
          return `Tool Output Pruning: ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => {
          await toggleMemorySetting("memoryToolPruningEnabled", d?.settings?.memoryToolPruningEnabled === true, "Tool Output Pruning");
          return true;
        }
      },
      {
        label: (d) => {
          const on = d?.settings?.memoryMediaPruningEnabled === true;
          return `Media & Attachment Pruning: ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => {
          await toggleMemorySetting("memoryMediaPruningEnabled", d?.settings?.memoryMediaPruningEnabled === true, "Media Pruning");
          return true;
        }
      },
      {
        label: (d) => {
          const on = d?.settings?.memoryCompactionEnabled === true;
          return `Sliding Window Compaction: ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => {
          await toggleMemorySetting("memoryCompactionEnabled", d?.settings?.memoryCompactionEnabled === true, "Sliding Compaction");
          return true;
        }
      },
      {
        label: (d) => {
          const on = d?.settings?.memoryCacheAnchorEnabled !== false;
          return `Prompt Cache Breakpoint Anchor: ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => {
          await toggleMemorySetting("memoryCacheAnchorEnabled", d?.settings?.memoryCacheAnchorEnabled !== false, "Cache Breakpoint Anchor");
          return true;
        }
      },
      {
        label: (d) => {
          const on = d?.settings?.memoryHandoffEnabled === true;
          return `Cross-Session Handoff Continuity: ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => {
          await toggleMemorySetting("memoryHandoffEnabled", d?.settings?.memoryHandoffEnabled === true, "Cross-Session Handoff");
          return true;
        }
      }
    ]
  });
}

/**
 * Toggle a memory setting via API
 * @param {string} settingKey
 * @param {boolean} currentlyOn
 * @param {string} displayName
 */
async function toggleMemorySetting(settingKey, currentlyOn, displayName) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ [settingKey]: next });
  if (result.success) {
    showStatus(`${displayName} ${next ? "enabled" : "disabled"}`, "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  await pause();
}

module.exports = { showMemoryMenu };
