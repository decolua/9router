const api = require("../api/client");
const { prompt } = require("./input");
const { clearScreen } = require("./display");

// Provider alias order: OAuth first, then Free, then API Key
const PROVIDER_ALIAS_ORDER = [
  "cc", "ag", "cx", "if", "qw", "gc", "gh", "kr", "oc",
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
  oc: "OpenCode Free",
  opencode: "OpenCode Free",
  openrouter: "OpenRouter",
  glm: "GLM Coding",
  kimi: "Kimi Coding",
  minimax: "Minimax Coding",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini"
};

const PROVIDER_ID_TO_ALIAS = {
  claude: "cc",
  codex: "cx",
  "gemini-cli": "gc",
  github: "gh",
  antigravity: "ag",
  iflow: "if",
  qwen: "qw",
  kiro: "kr",
  cursor: "cu",
  cline: "cline",
  clinepass: "clinepass",
  qoder: "qd",
  "qoder-cn": "qd",
  gitlab: "gitlab",
  "codebuddy-cn": "cb",
  "codebuddy-intl": "cbai",
  kimchi: "kimchi",
  "grok-cli": "grok-cli",
  trae: "trae",
  windsurf: "windsurf",
  zed: "zed",
  opencode: "oc",
  "opencode-go": "ocg",
  "opencode-zen": "ocz",
};

// Providers usable without stored credentials
const NO_AUTH_PROVIDERS = new Set(["opencode", "oc"]);

/**
 * Get all available models grouped by provider + combos (filtered by active connections)
 * @returns {Promise<{combos: Array, groups: Object}>}
 */
async function getAvailableModelsGrouped() {
  const [modelsResult, providersResult] = await Promise.all([
    api.getAvailableModels(),
    api.getProviders()
  ]);

  if (!modelsResult.success) return { combos: [], groups: {} };

  const connections = providersResult.success ? (providersResult.data?.connections || []) : [];
  const activeAliases = new Set(NO_AUTH_PROVIDERS);

  connections.forEach(conn => {
    if (conn.isActive === false) return;
    const p = conn.provider;
    if (!p) return;
    activeAliases.add(p);
    const alias = conn.providerSpecificData?.prefix || PROVIDER_ID_TO_ALIAS[p] || p;
    activeAliases.add(alias);
  });

  const models = modelsResult.data?.data || [];
  const combos = [];
  const groups = {};

  models.forEach(m => {
    if (m.owned_by === "combo") {
      combos.push(m.id);
    } else {
      const provider = m.owned_by;
      // Only keep connected providers or noAuth providers
      if (!activeAliases.has(provider)) return;
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(m.id);
    }
  });

  return { combos, groups };
}

/**
 * Display model list and prompt for selection with provider grouping & search
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
    clearScreen();
    console.log(`\n🎯 ${title}`);
    console.log("=".repeat(50));
    console.log("\n  No connected providers found.");
    console.log("  Please connect a provider in Providers menu first.\n");
    console.log("  m. ✍️  Enter custom model ID");
    console.log("  0. Cancel\n");
    const act = await prompt("Select option (m/0): ");
    const trimmed = act.trim();
    if (trimmed.toLowerCase() === "m") {
      const custom = await prompt("Enter custom model ID: ");
      return custom.trim() || null;
    }
    return null;
  }

  // All models for flat search
  const allModelsList = [
    ...combos,
    ...Object.values(groups).flat()
  ];

  // Build category list
  const categories = [];
  if (combos.length > 0) {
    categories.push({
      id: "combos",
      name: "[Combos]",
      models: combos
    });
  }

  const sortedProviders = Object.keys(groups).sort((a, b) => {
    const idxA = PROVIDER_ALIAS_ORDER.indexOf(a);
    const idxB = PROVIDER_ALIAS_ORDER.indexOf(b);
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });

  sortedProviders.forEach((provider) => {
    const providerName = PROVIDER_ALIAS_NAMES[provider] || provider;
    categories.push({
      id: provider,
      name: providerName,
      models: groups[provider]
    });
  });

  let filterQuery = null;

  while (true) {
    clearScreen();
    console.log(`\n🎯 ${title}`);
    console.log("=".repeat(50));
    if (currentValue) {
      console.log(`Current: ${currentValue}\n`);
    } else {
      console.log();
    }

    // Active search view
    if (filterQuery !== null) {
      const q = filterQuery.toLowerCase().trim();
      const matched = allModelsList.filter((m) => m.toLowerCase().includes(q));

      console.log(`🔍 Search results for "${filterQuery}": (${matched.length} found)\n`);
      if (matched.length === 0) {
        console.log("  No matching models found.\n");
        console.log("  0. ← Back to providers");
        console.log("  s. Search again\n");
        const act = await prompt("Select option: ");
        if (act.toLowerCase() === "s") {
          const newQ = await prompt("Enter search keyword: ");
          filterQuery = newQ.trim() || null;
        } else {
          filterQuery = null;
        }
        continue;
      }

      matched.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m}`);
      });
      console.log("\n  0. ← Back to providers");
      console.log("  s. Search again\n");

      const input = await prompt("Enter number to select (or 0/s): ");
      if (input.toLowerCase() === "s") {
        const newQ = await prompt("Enter search keyword: ");
        filterQuery = newQ.trim() || null;
        continue;
      }
      const num = parseInt(input, 10);
      if (isNaN(num) || num === 0) {
        filterQuery = null;
        continue;
      }
      if (num > 0 && num <= matched.length) {
        return matched[num - 1];
      }
      continue;
    }

    // If only 1 category exists, jump straight into its model list
    if (categories.length === 1) {
      const singleCategory = categories[0];
      console.log(`[${singleCategory.name}]`);
      singleCategory.models.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m}`);
      });
      console.log();
      console.log("  s. 🔍 Search models");
      console.log("  m. ✍️  Enter custom model ID");
      console.log("  0. Cancel\n");

      const input = await prompt("Enter choice (number / s / m / 0): ");
      const trimmed = input.trim();
      if (!trimmed || trimmed === "0") return null;

      const lower = trimmed.toLowerCase();
      if (lower === "s") {
        const q = await prompt("Enter search keyword: ");
        if (q.trim()) filterQuery = q.trim();
        continue;
      }
      if (lower === "m") {
        const customModel = await prompt("Enter custom model ID: ");
        if (customModel.trim()) return customModel.trim();
        continue;
      }

      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num > 0 && num <= singleCategory.models.length) {
        return singleCategory.models[num - 1];
      }
      filterQuery = trimmed;
      continue;
    }

    // Multiple categories view
    console.log("[Providers & Groups]");
    categories.forEach((cat, i) => {
      console.log(`  ${i + 1}. ${cat.name} (${cat.models.length} models)`);
    });

    console.log();
    console.log("  s. 🔍 Search models");
    console.log("  m. ✍️  Enter custom model ID");
    console.log("  0. Cancel\n");

    const input = await prompt("Enter choice (number / keyword / s / m): ");
    const trimmed = input.trim();

    if (!trimmed || trimmed === "0") {
      return null;
    }

    const lower = trimmed.toLowerCase();
    if (lower === "s") {
      const q = await prompt("Enter search keyword: ");
      if (q.trim()) {
        filterQuery = q.trim();
      }
      continue;
    }

    if (lower === "m") {
      const customModel = await prompt("Enter custom model ID: ");
      if (customModel.trim()) {
        return customModel.trim();
      }
      continue;
    }

    const num = parseInt(trimmed, 10);
    // Selected a category
    if (!isNaN(num) && num > 0 && num <= categories.length) {
      const selectedCategory = categories[num - 1];

      while (true) {
        clearScreen();
        console.log(`\n🎯 ${title} > ${selectedCategory.name}`);
        console.log("=".repeat(50));
        if (currentValue) {
          console.log(`Current: ${currentValue}\n`);
        } else {
          console.log();
        }

        selectedCategory.models.forEach((m, i) => {
          console.log(`  ${i + 1}. ${m}`);
        });
        console.log("\n  0. ← Back\n");

        const modelChoice = await prompt("Enter number to select (0 to back): ");
        const modelNum = parseInt(modelChoice, 10);
        if (isNaN(modelNum) || modelNum === 0) {
          break;
        }
        if (modelNum > 0 && modelNum <= selectedCategory.models.length) {
          return selectedCategory.models[modelNum - 1];
        }
      }
      continue;
    }

    // User typed text directly -> treat as search query
    filterQuery = trimmed;
  }
}

module.exports = {
  selectModelFromList,
  getAvailableModelsGrouped,
  PROVIDER_ALIAS_ORDER,
  PROVIDER_ALIAS_NAMES
};
