const api = require("../api/client");
const { prompt } = require("./input");
const { clearScreen } = require("./display");

// Provider alias order: OAuth first, then API Key (matches ModelSelectModal)
const PROVIDER_ALIAS_ORDER = [
  "cc", "ag", "cx", "if", "qw", "gc", "gh", "kr",
  "openrouter", "glm", "kimi", "minimax", "openai", "anthropic", "gemini"
];

// Alias to display name mapping
const PROVIDER_ALIAS_NAMES = {
  cc: "Claude Code",
  ag: "Antigravity", 
  cx: "OpenAI Codex",
  if: "iFlow AI",
  qw: "Qwen Code",
  gc: "Gemini CLI",
  gh: "GitHub Copilot",
  kr: "Kiro AI",
  openrouter: "OpenRouter",
  glm: "GLM Coding",
  kimi: "Kimi Coding",
  minimax: "Minimax Coding",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini"
};

/**
 * Get all available models grouped by provider + combos
 * @returns {Promise<{combos: Array, groups: Object}>}
 */
async function getAvailableModelsGrouped() {
  const result = await api.getAvailableModels();
  if (!result.success) return { combos: [], groups: {} };
  
  const models = result.data?.data || [];
  const combos = [];
  const groups = {};
  
  models.forEach(m => {
    if (m.owned_by === "combo") {
      combos.push(m.id);
    } else {
      const provider = m.owned_by;
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(m.id);
    }
  });
  
  return { combos, groups };
}

/**
 * Display model list and prompt for selection
 * @param {string} title - Title to display
 * @param {string} currentValue - Current selected value (optional)
 * @param {Object} options - { excludeCombos?: boolean }
 * @returns {Promise<string|null>} Selected model ID or null if cancelled
 */
async function selectModelFromList(title, currentValue = "", options = {}) {
  const { excludeCombos = false } = options;
  const { combos: rawCombos, groups } = await getAvailableModelsGrouped();
  const combos = excludeCombos ? [] : rawCombos;

  const totalModels = combos.length + Object.values(groups).flat().length;
  if (totalModels === 0) {
    return null;
  }
  
  // Build flat list for selection
  const allModels = [];
  
  // Display
  clearScreen();
  console.log(`\n🎯 ${title}`);
  console.log("=".repeat(50));
  if (currentValue) {
    console.log(`Current: ${currentValue}\n`);
  } else {
    console.log();
  }
  
  let idx = 1;
  
  // Combos first (skipped when excludeCombos is true)
  if (combos.length > 0) {
    console.log("[Combos]");
    combos.forEach(combo => {
      console.log(`  ${idx}. ${combo}`);
      allModels.push(combo);
      idx++;
    });
    console.log();
  }
  
  // Provider groups in order (by alias)
  const sortedProviders = Object.keys(groups).sort((a, b) => {
    const idxA = PROVIDER_ALIAS_ORDER.indexOf(a);
    const idxB = PROVIDER_ALIAS_ORDER.indexOf(b);
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });
  
  sortedProviders.forEach(provider => {
    const providerName = PROVIDER_ALIAS_NAMES[provider] || provider;
    console.log(`[${providerName}]`);
    groups[provider].forEach(model => {
      console.log(`  ${idx}. ${model}`);
      allModels.push(model);
      idx++;
    });
    console.log();
  });
  
  console.log("  0. Cancel\n");
  
  // Prompt for number input
  const input = await prompt("Enter number: ");
  const num = parseInt(input, 10);
  
  if (isNaN(num) || num === 0 || num < 0 || num > allModels.length) {
    return null;
  }
  
  return allModels[num - 1];
}

module.exports = {
  selectModelFromList,
  getAvailableModelsGrouped,
  PROVIDER_ALIAS_ORDER,
  PROVIDER_ALIAS_NAMES
};
