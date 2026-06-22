const api = require("../api/client");
const { pause, confirm, prompt } = require("../utils/input");
const { showStatus } = require("../utils/display");
const { selectModelFromList } = require("../utils/modelSelector");
const { showMenuWithBack, showListMenu } = require("../utils/menuHelper");
const { getEndpoint } = require("../utils/endpoint");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m"
};

// Claude model types with defaults (matching Web UI)
const CLAUDE_MODEL_TYPES = [
  { id: "sonnet", name: "Sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", defaultValue: "cc/claude-sonnet-4-5-20250929" },
  { id: "opus",   name: "Opus",   envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL",   defaultValue: "cc/claude-opus-4-5-20251101" },
  { id: "haiku",  name: "Haiku",  envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL",  defaultValue: "cc/claude-haiku-4-5-20251001" },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Get first available API key from server
 * @returns {Promise<string|null>}
 */
async function getFirstApiKey() {
  const result = await api.getApiKeys();
  const keys = result.success ? (result.data.keys || []) : [];
  return keys.length > 0 ? keys[0].key : null;
}

// ─── Claude Code ──────────────────────────────────────────────────────────────

/**
 * Build header showing current Claude config status
 * @returns {Promise<string>}
 */
async function buildClaudeHeader() {
  const result = await api.getCliToolSettings("claude");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const settings = result.data.settings;
  const currentUrl = settings?.env?.ANTHROPIC_BASE_URL;
  const currentKey = settings?.env?.ANTHROPIC_AUTH_TOKEN;
  const lines = [];

  if (currentUrl) {
    lines.push(`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`);
    lines.push(`Endpoint: ${COLORS.cyan}${currentUrl}${COLORS.reset}`);
    if (currentKey) {
      lines.push(`API Key:  ${COLORS.dim}${currentKey.substring(0, 10)}...${COLORS.reset}`);
    }
  } else {
    lines.push(`Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`);
    lines.push(`${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`);
  }

  return lines.join("\n");
}

/**
 * Get current Claude model from settings
 * @param {string} envKey
 * @returns {Promise<string>}
 */
async function getClaudeModel(envKey) {
  const result = await api.getCliToolSettings("claude");
  return result.success ? (result.data.settings?.env?.[envKey] || "Not set") : "Not set";
}

/**
 * Quick setup for Claude Code — sets endpoint, key, and all default models
 * @param {number} port
 */
async function claudeQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const env = { ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: apiKey, API_TIMEOUT_MS: "600000" };
  CLAUDE_MODEL_TYPES.forEach(t => { env[t.envKey] = t.defaultValue; });

  const result = await api.applyCliToolSettings("claude", { env });
  showStatus(result.success ? "Quick Setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Select and save a specific Claude model type
 * @param {Object} modelType
 * @param {number} port
 */
async function claudeSelectModel(modelType, port) {
  const current = await getClaudeModel(modelType.envKey);
  const selected = await selectModelFromList(`Select ${modelType.name} Model`, current, { excludeCombos: true });
  if (!selected) return;

  const env = { [modelType.envKey]: selected };

  // Also set base URL if not configured yet
  const settingsResult = await api.getCliToolSettings("claude");
  if (!settingsResult.data?.settings?.env?.ANTHROPIC_BASE_URL) {
    const { endpoint } = await getEndpoint(port);
    const apiKey = await getFirstApiKey();
    env.ANTHROPIC_BASE_URL = endpoint;
    env.API_TIMEOUT_MS = "600000";
    if (apiKey) env.ANTHROPIC_AUTH_TOKEN = apiKey;
  }

  const result = await api.applyCliToolSettings("claude", { env });
  showStatus(result.success ? `${modelType.name} → ${selected} saved!` : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Claude Code settings
 */
async function claudeReset() {
  const result = await api.resetCliToolSettings("claude");
  showStatus(result.success ? "Settings reset successfully!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Claude Code submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showClaudeCodeMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🔧 Claude Code Settings",
    breadcrumb,
    headerContent: buildClaudeHeader,
    refresh: async () => ({
      sonnet: await getClaudeModel("ANTHROPIC_DEFAULT_SONNET_MODEL"),
      opus:   await getClaudeModel("ANTHROPIC_DEFAULT_OPUS_MODEL"),
      haiku:  await getClaudeModel("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    }),
    items: [
      {
        label: "⚡ Quick Setup (recommended)",
        action: async () => { await claudeQuickSetup(port); return true; }
      },
      {
        label: (d) => `Sonnet → ${d.sonnet}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[0], port); return true; }
      },
      {
        label: (d) => `Opus → ${d.opus}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[1], port); return true; }
      },
      {
        label: (d) => `Haiku → ${d.haiku}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[2], port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await claudeReset(); return true; }
      }
    ]
  });
}

// ─── Codex CLI ────────────────────────────────────────────────────────────────

/**
 * Build header showing current Codex config status
 * @returns {Promise<string>}
 */
async function buildCodexHeader() {
  const result = await api.getCliToolSettings("codex");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, config } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ Codex CLI not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  // Parse base_url and model from raw TOML string
  const baseUrlMatch = config && config.match(/base_url\s*=\s*"([^"]+)"/);
  const modelMatch = config && config.match(/^model\s*=\s*"([^"]+)"/m);
  const baseUrl = baseUrlMatch ? baseUrlMatch[1] : "";
  const model = modelMatch ? modelMatch[1] : "";

  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (baseUrl) lines.push(`Endpoint: ${COLORS.cyan}${baseUrl}${COLORS.reset}`);
  if (model)   lines.push(`Model:    ${COLORS.dim}${model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Codex CLI
 * @param {number} port
 */
async function codexQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  // Get model selection
  const model = await selectModelFromList("Select Codex Model", "cx/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("codex", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Codex setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Codex CLI settings
 */
async function codexReset() {
  const result = await api.resetCliToolSettings("codex");
  showStatus(result.success ? "Codex settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Codex CLI submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showCodexMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🤖 Codex CLI Settings",
    breadcrumb,
    headerContent: buildCodexHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Quick Setup",
        action: async () => { await codexQuickSetup(port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await codexReset(); return true; }
      }
    ]
  });
}

// ─── Factory Droid ────────────────────────────────────────────────────────────

/**
 * Build header showing current Droid config status
 * @returns {Promise<string>}
 */
async function buildDroidHeader() {
  const result = await api.getCliToolSettings("droid");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ Factory Droid not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  // Extract 9Router custom model config
  const custom = settings?.customModels?.find(m => m.id === "custom:9Router-0");
  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (custom?.baseUrl) lines.push(`Endpoint: ${COLORS.cyan}${custom.baseUrl}${COLORS.reset}`);
  if (custom?.model)   lines.push(`Model:    ${COLORS.dim}${custom.model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Factory Droid
 * @param {number} port
 */
async function droidQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Select Droid Model", "cc/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("droid", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Factory Droid setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Factory Droid settings
 */
async function droidReset() {
  const result = await api.resetCliToolSettings("droid");
  showStatus(result.success ? "Factory Droid settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Factory Droid submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showDroidMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🤖 Factory Droid Settings",
    breadcrumb,
    headerContent: buildDroidHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Quick Setup",
        action: async () => { await droidQuickSetup(port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await droidReset(); return true; }
      }
    ]
  });
}

// ─── Open Claw ────────────────────────────────────────────────────────────────

/**
 * Build header showing current OpenClaw config status
 * @returns {Promise<string>}
 */
async function buildOpenClawHeader() {
  const result = await api.getCliToolSettings("openclaw");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ Open Claw not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  // Extract 9Router provider config
  const provider = settings?.models?.providers?.["9router"];
  const primary = settings?.agents?.defaults?.model?.primary || "";
  const model = primary.startsWith("9router/") ? primary.replace("9router/", "") : (provider?.models?.[0]?.id || "");
  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (provider?.baseUrl) lines.push(`Endpoint: ${COLORS.cyan}${provider.baseUrl}${COLORS.reset}`);
  if (model)             lines.push(`Model:    ${COLORS.dim}${model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Open Claw
 * @param {number} port
 */
async function openClawQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Select OpenClaw Model", "cc/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("openclaw", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Open Claw setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Open Claw settings
 */
async function openClawReset() {
  const result = await api.resetCliToolSettings("openclaw");
  showStatus(result.success ? "Open Claw settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Open Claw submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showOpenClawMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🦞 Open Claw Settings",
    breadcrumb,
    headerContent: buildOpenClawHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Quick Setup",
        action: async () => { await openClawQuickSetup(port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await openClawReset(); return true; }
      }
    ]
  });
}

// ─── OpenCode CLI ─────────────────────────────────────────────────────────────

async function buildOpenCodeHeader() {
  const result = await api.getCliToolSettings("opencode");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, opencode } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ OpenCode CLI not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (opencode?.baseURL) lines.push(`Endpoint: ${COLORS.cyan}${opencode.baseURL}${COLORS.reset}`);
  if (opencode?.activeModel) lines.push(`Active:   ${COLORS.dim}${opencode.activeModel}${COLORS.reset}`);
  if (Array.isArray(opencode?.models) && opencode.models.length > 0) {
    lines.push(`Models:   ${COLORS.dim}${opencode.models.join(", ")}${COLORS.reset}`);
  }
  return lines.join("\n");
}

async function openCodeQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  // Pick first model (also becomes active model by default)
  const firstModel = await selectModelFromList("Select Active Model (OpenCode)", "", { excludeCombos: true });
  if (!firstModel) return;

  const models = [firstModel];

  // Optionally add more models
  while (true) {
    const more = await confirm(`Add another model? (current: ${models.length})`);
    if (!more) break;
    const next = await selectModelFromList(`Add Model #${models.length + 1}`, models.join(", "), { excludeCombos: true });
    if (!next) break;
    if (!models.includes(next)) models.push(next);
  }

  // Optional subagent model
  let subagentModel = firstModel;
  const wantSubagent = await confirm(`Set a different subagent model? (default: ${firstModel})`);
  if (wantSubagent) {
    const picked = await selectModelFromList("Select Subagent Model", firstModel, { excludeCombos: true });
    if (picked) subagentModel = picked;
  }

  const result = await api.applyCliToolSettings("opencode", {
    baseUrl: endpoint,
    apiKey,
    models,
    activeModel: firstModel,
    subagentModel,
  });
  showStatus(result.success ? "OpenCode setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function openCodeReset() {
  const result = await api.resetCliToolSettings("opencode");
  showStatus(result.success ? "OpenCode settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function showOpenCodeMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "💻 OpenCode CLI Settings",
    breadcrumb,
    headerContent: buildOpenCodeHeader,
    refresh: async () => ({}),
    items: [
      { label: "⚡ Quick Setup", action: async () => { await openCodeQuickSetup(port); return true; } },
      { label: "Reset to Default", action: async () => { await openCodeReset(); return true; } }
    ]
  });
}

// ─── Hermes Agent ─────────────────────────────────────────────────────────────

/**
 * Build the header for the Hermes menu, showing the active profile if any.
 * @returns {Promise<string>}
 */
async function buildHermesHeader() {
  // Show installed status from hermes-settings
  const settingsResult = await api.getCliToolSettings("hermes");
  const installed = settingsResult.success ? settingsResult.data.installed : null;
  const has9Router = settingsResult.success ? settingsResult.data.has9Router : false;

  if (installed === false) {
    return `Status:   ${COLORS.red}✗ Hermes Agent not installed${COLORS.reset}`;
  }

  // Also show active profile from the profiles store
  const profilesResult = await api.getHermesProfiles();
  const activeProfile = profilesResult.success ? profilesResult.data.activeProfile : null;
  const totalProfiles = profilesResult.success ? profilesResult.data.profiles.length : 0;

  const lines = [];

  if (activeProfile) {
    lines.push(`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`);
    lines.push(`Profile:  ${COLORS.cyan}${activeProfile.name}${COLORS.reset}${totalProfiles > 1 ? COLORS.dim + ` (${totalProfiles} profiles)` + COLORS.reset : ""}`);
    if (activeProfile.baseUrl) lines.push(`Endpoint: ${COLORS.dim}${activeProfile.baseUrl}${COLORS.reset}`);
    if (activeProfile.model)   lines.push(`Model:    ${COLORS.dim}${activeProfile.model}${COLORS.reset}`);
  } else if (has9Router) {
    // On-disk config exists but no profiles in DB yet (rare edge case)
    const settings = settingsResult.data?.settings || {};
    const model = settings.model || {};
    lines.push(`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`);
    if (model.base_url) lines.push(`Endpoint: ${COLORS.dim}${model.base_url}${COLORS.reset}`);
    if (model.default)  lines.push(`Model:    ${COLORS.dim}${model.default}${COLORS.reset}`);
  } else {
    lines.push(`Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`);
    lines.push(`${COLORS.dim}Run "Quick Setup" to create your first profile${COLORS.reset}`);
  }

  return lines.join("\n");
}

/**
 * Quick Setup: prompts for model, creates a new profile named by the user, and
 * activates it (writes to disk).  If no profiles exist yet, names it "default".
 * @param {number} port
 */
async function hermesQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Select Hermes Model", "", { excludeCombos: true });
  if (!model) return;

  // Ask for a profile name
  const defaultName = "default";
  const nameInput = await prompt(`Profile name (default: "${defaultName}"): `);
  const name = nameInput || defaultName;

  // Create the profile in the DB
  const createResult = await api.createHermesProfile({
    name,
    baseUrl: endpoint,
    model,
    apiKey,
  });
  if (!createResult.success) {
    showStatus(`Failed to create profile: ${createResult.error}`, "error");
    await pause();
    return;
  }

  // Activate it (writes to disk)
  const profileId = createResult.data.profile.id;
  const activateResult = await api.activateHermesProfile(profileId);
  showStatus(
    activateResult.success
      ? `Profile "${name}" created and activated!`
      : `Created but failed to activate: ${activateResult.error}`,
    activateResult.success ? "success" : "error"
  );
  await pause();
}

/**
 * Reset: removes the active profile's model block from config.yaml.
 * Does NOT delete the profile record from the DB.
 */
async function hermesReset() {
  const result = await api.resetCliToolSettings("hermes");
  showStatus(
    result.success ? "Active profile reset from disk!" : `Failed: ${result.error}`,
    result.success ? "success" : "error"
  );
  await pause();
}

// ─── Profile management sub-menu ──────────────────────────────────────────────

/**
 * Show the per-profile action menu (Activate / Rename / Delete).
 * @param {Object} profile
 * @param {string} activeProfileId
 */
async function showProfileActionMenu(profile, activeProfileId) {
  const isActive = profile.id === activeProfileId;
  const title = `Profile: ${profile.name}${isActive ? " (active)" : ""}`;
  const headerLines = [
    `Endpoint: ${COLORS.dim}${profile.baseUrl}${COLORS.reset}`,
    `Model:    ${COLORS.dim}${profile.model}${COLORS.reset}`,
  ];
  if (isActive) {
    headerLines.unshift(`${COLORS.green}★ Active profile${COLORS.reset}`);
  }

  const items = [];

  if (!isActive) {
    items.push({
      label: "✅ Activate (write to disk)",
      action: async () => {
        const result = await api.activateHermesProfile(profile.id);
        showStatus(
          result.success
            ? `Profile "${profile.name}" activated!`
            : `Failed: ${result.error}`,
          result.success ? "success" : "error"
        );
        await pause();
        return false; // exit this submenu after activating
      },
    });
  }

  items.push({
    label: "✏ Rename",
    action: async () => {
      const newName = await prompt(`New name (current: "${profile.name}"): `);
      if (!newName || !newName.trim()) { showStatus("Name not changed.", "error"); await pause(); return true; }
      const result = await api.updateHermesProfile(profile.id, { name: newName.trim() });
      showStatus(
        result.success ? `Renamed to "${newName.trim()}"` : `Failed: ${result.error}`,
        result.success ? "success" : "error"
      );
      await pause();
      return false; // exit so the list refreshes
    },
  });

  items.push({
    label: `${COLORS.red}🗑 Delete${COLORS.reset}`,
    action: async () => {
      const ok = await confirm(`Delete profile "${profile.name}"?`);
      if (!ok) return true;
      const result = await api.deleteHermesProfile(profile.id);
      showStatus(
        result.success ? `Profile "${profile.name}" deleted.` : `Failed: ${result.error}`,
        result.success ? "success" : "error"
      );
      await pause();
      return false; // exit
    },
  });

  await showMenuWithBack({
    title,
    headerContent: headerLines.join("\n"),
    items,
  });
}

/**
 * Show the profile list menu (list → select → per-profile actions).
 */
async function showHermesProfilesMenu(port, breadcrumb = []) {
  await showListMenu({
    title: "📋 Hermes Profiles",
    breadcrumb,
    headerContent: async () => {
      const result = await api.getHermesProfiles();
      if (!result.success) return `${COLORS.red}Failed to load profiles${COLORS.reset}`;
      const { profiles, activeProfile } = result.data;
      if (!profiles.length) return `${COLORS.dim}No profiles yet. Create one to get started.${COLORS.reset}`;
      return activeProfile
        ? `Active:   ${COLORS.green}${activeProfile.name}${COLORS.reset}\nProfiles: ${profiles.length}`
        : `Profiles: ${profiles.length}`;
    },
    fetchItems: async () => {
      const result = await api.getHermesProfiles();
      if (!result.success) return { items: [], metadata: {} };
      const { profiles, activeProfileId } = result.data;
      return {
        items: profiles.map((profile) => ({
          ...profile,
          _active: profile.id === activeProfileId,
        })),
        metadata: { activeProfileId },
      };
    },
    formatItem: (profile) => {
      // dynamically resolved at render time via metadata — but showListMenu
      // doesn't pass metadata to formatItem; we fetch it inside the closure.
      return profile._active
        ? `${COLORS.green}★ ${profile.name}${COLORS.reset} — ${COLORS.dim}${profile.model}${COLORS.reset}`
        : `  ${profile.name} — ${COLORS.dim}${profile.model}${COLORS.reset}`;
    },
    onSelect: async (profile) => {
      // Fetch fresh store to get current activeProfileId
      const storeResult = await api.getHermesProfiles();
      const activeProfileId = storeResult.success ? storeResult.data.activeProfileId : null;
      await showProfileActionMenu(profile, activeProfileId);
    },
    createAction: {
      label: "➕ Create New Profile",
      action: async () => {
        // Inline create flow
        const name = await prompt("Profile name: ");
        if (!name || !name.trim()) { showStatus("Cancelled.", "error"); await pause(); return; }

        const model = await selectModelFromList("Select Model", "", { excludeCombos: true });
        if (!model) return;

        // Default to the local 9Router endpoint
        const endpointInput = await prompt("Base URL (leave blank for local endpoint): ");
        let baseUrl = endpointInput.trim();
        if (!baseUrl) {
          // Try to get the local endpoint from the server connection config
          try {
            const { endpoint } = await getEndpoint(port);
            baseUrl = endpoint;
          } catch {
            baseUrl = "http://127.0.0.1:20128";
          }
        }

        const apiKey = await getFirstApiKey();
        const createResult = await api.createHermesProfile({
          name: name.trim(),
          baseUrl,
          model,
          apiKey: apiKey || undefined,
        });
        if (!createResult.success) {
          showStatus(`Failed: ${createResult.error}`, "error");
          await pause();
          return;
        }

        const activate = await confirm(`Activate "${name.trim()}" now?`);
        if (activate) {
          const activateResult = await api.activateHermesProfile(createResult.data.profile.id);
          showStatus(
            activateResult.success ? `Profile "${name.trim()}" created and activated!` : `Created but failed to activate: ${activateResult.error}`,
            activateResult.success ? "success" : "error"
          );
        } else {
          showStatus(`Profile "${name.trim()}" created.`, "success");
        }
        await pause();
      },
    },
  });
}

/**
 * Hermes Agent main submenu.
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showHermesMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "⚡ Hermes Agent Settings",
    breadcrumb,
    headerContent: buildHermesHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Quick Setup (create & activate profile)",
        action: async () => { await hermesQuickSetup(port); return true; }
      },
      {
        label: "📋 Manage Profiles",
        action: async () => { await showHermesProfilesMenu(port, [...breadcrumb, "Profiles"]); return true; }
      },
      {
        label: "Reset Active Profile (remove from disk)",
        action: async () => { await hermesReset(); return true; }
      },
    ]
  });
}

// ─── Main CLI Tools Menu ──────────────────────────────────────────────────────

/**
 * Main CLI Tools menu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showCliToolsMenu(port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  await showMenuWithBack({
    title: "🔧 CLI Tools",
    breadcrumb,
    headerContent: `Configure CLI tools to use 9Router\nEndpoint: ${endpoint}`,
    items: [
      {
        label: "Claude Code",
        action: async () => { await showClaudeCodeMenu(port, [...breadcrumb, "Claude Code"]); return true; }
      },
      {
        label: "Codex CLI",
        action: async () => { await showCodexMenu(port, [...breadcrumb, "Codex CLI"]); return true; }
      },
      {
        label: "Factory Droid",
        action: async () => { await showDroidMenu(port, [...breadcrumb, "Factory Droid"]); return true; }
      },
      {
        label: "Open Claw",
        action: async () => { await showOpenClawMenu(port, [...breadcrumb, "Open Claw"]); return true; }
      },
      {
        label: "OpenCode",
        action: async () => { await showOpenCodeMenu(port, [...breadcrumb, "OpenCode"]); return true; }
      },
      {
        label: "Hermes",
        action: async () => { await showHermesMenu(port, [...breadcrumb, "Hermes"]); return true; }
      }
    ]
  });
}

module.exports = { showCliToolsMenu };
