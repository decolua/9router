const api = require("../api/client");
const { prompt, select, selectMenu, multiSelect, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { maskKey, formatDate, getRelativeTime } = require("../utils/format");
const { showMenuWithBack } = require("../utils/menuHelper");
const { copyToClipboard } = require("../utils/clipboard");
const { getEndpoint } = require("../utils/endpoint");

/**
 * Display API keys list with formatted output
 * @param {Array} keys - Array of API key objects
 * @param {number} port - Server port
 */
function displayApiKeys(keys, port) {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  🔑 API Keys Management                                 │");
  console.log("├─────────────────────────────────────────────────────────┤");
  // Note: This function is legacy, endpoint shown in menu header instead
  console.log("│                                                          │");
  
  if (keys.length === 0) {
    console.log("│  No API keys found.                                     │");
  } else {
    console.log(`│  Your API Keys (${keys.length}):${" ".repeat(42 - String(keys.length).length)}│`);
    
    keys.forEach((key, index) => {
      console.log("│                                                          │");
      console.log(`│  ${index + 1}. ${key.name}${" ".repeat(52 - String(index + 1).length - key.name.length)}│`);
      
      const maskedKey = maskKey(key.key);
      console.log(`│     Key: ${maskedKey}${" ".repeat(47 - maskedKey.length)}│`);
      
      const created = formatDate(key.createdAt);
      console.log(`│     Created: ${created}${" ".repeat(43 - created.length)}│`);
      
      if (key.lastUsedAt) {
        const lastUsed = getRelativeTime(key.lastUsedAt);
        console.log(`│     Last used: ${lastUsed}${" ".repeat(41 - lastUsed.length)}│`);
      } else {
        console.log("│     Last used: Never                                    │");
      }
    });
  }
  
  console.log("│                                                          │");
  console.log("│  Actions:                                               │");
  console.log("│  1. Create New API Key                                  │");
  console.log("│  2. View Full Key (by number)                           │");
  console.log("│  3. Copy Key to Clipboard (by number)                   │");
  console.log("│  4. Delete Key (by number)                              │");
  console.log("│  5. Rotate Key (by number)                              │");
  console.log("│  0. ← Back to Main Menu                                 │");
  console.log("└─────────────────────────────────────────────────────────┘");
}

/**
 * Handle creating new API key
 * @returns {Promise<boolean>} Success status
 */
async function handleCreateKey() {
  console.log("\n📝 Create New API Key");
  console.log("─".repeat(30));
  
  const name = await prompt("Enter key name: ");
  
  if (!name) {
    showStatus("Key name cannot be empty", "error");
    await pause();
    return false;
  }
  
  const result = await api.createApiKey(name);
  
  if (!result.success) {
    showStatus(`Failed to create key: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  console.log("\n✅ API Key created successfully!");
  console.log("\n⚠️  IMPORTANT: Save this key now. You won't be able to see it again!");
  console.log(`\nKey: ${result.data.key}`);
  console.log(`Name: ${result.data.name}`);
  console.log(`ID: ${result.data.id}`);
  
  const shouldCopy = await confirm("\nCopy key to clipboard?");
  if (shouldCopy) {
    if (copyToClipboard(result.data.key)) {
      showStatus("Key copied to clipboard!", "success");
    } else {
      showStatus("Failed to copy to clipboard", "error");
    }
  }
  
  await pause();
  return true;
}

/**
 * Handle viewing full API key
 * @param {Object} key - API key object
 */
async function handleViewFullKey(key) {
  console.log("\n🔍 Full API Key");
  console.log("─".repeat(30));
  console.log(`Name: ${key.name}`);
  console.log(`Key: ${key.key}`);
  console.log(`ID: ${key.id}`);
  console.log(`Created: ${formatDate(key.createdAt)}`);
  
  if (key.lastUsedAt) {
    console.log(`Last used: ${getRelativeTime(key.lastUsedAt)}`);
  } else {
    console.log("Last used: Never");
  }
  
  await pause();
}

/**
 * Handle copying API key to clipboard
 * @param {Object} key - API key object
 */
async function handleCopyKey(key) {
  if (copyToClipboard(key.key)) {
    showStatus(`Key "${key.name}" copied to clipboard!`, "success");
  } else {
    showStatus("Failed to copy to clipboard", "error");
  }
  await pause();
}

/**
 * Handle deleting API key
 * @param {Object} key - API key object
 * @returns {Promise<boolean>} Success status
 */
async function handleDeleteKey(key) {
  console.log(`\n⚠️  Delete API Key: ${key.name}`);
  console.log("─".repeat(30));
  console.log(`Key: ${maskKey(key.key)}`);
  console.log(`Created: ${formatDate(key.createdAt)}`);
  
  const confirmed = await confirm("\nAre you sure you want to delete this key?");
  
  if (!confirmed) {
    showStatus("Deletion cancelled", "info");
    await pause();
    return false;
  }
  
  const result = await api.deleteApiKey(key.id);
  
  if (!result.success) {
    showStatus(`Failed to delete key: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  showStatus("API key deleted successfully", "success");
  await pause();
  return true;
}

async function handleRotateKey(keys) {
  const index = await select("Select a key to rotate:", keys.map(key => key.name));
  const { id, name, keyVersion } = keys[index];
  if (!await confirm(`Rotate "${name}"? The old key will stop working immediately.`)) return;

  const result = await api.rotateApiKey(id, keyVersion);
  if (result.statusCode === 409) {
    showStatus("This key changed elsewhere. Select it again from the refreshed list.", "warning");
  } else if (result.statusCode === 405 || (result.statusCode === 404 && result.error !== "Key not found")) {
    showStatus("This server does not support key rotation.", "error");
  } else if (!result.success || result.statusCode !== 200 || !result.data?.key) {
    showStatus(result.error || "Failed to rotate key", "error");
  } else {
    console.log("Save the new key now. This confirmation will not be shown again.");
    console.log(`Key: ${result.data.key}`);
    if (await confirm("Copy key to clipboard?")) {
      const copied = copyToClipboard(result.data.key);
      showStatus(copied ? "Key copied to clipboard!" : "Failed to copy to clipboard", copied ? "success" : "error");
    }
  }
  await pause();
}

function accountError(result, fallback) {
  if (result.statusCode === 401 || result.statusCode === 403) {
    return `Administrator access required (HTTP ${result.statusCode})`;
  }
  return result.error || fallback;
}

async function handleAllowedAccounts(key) {
  const result = await api.getProviders();
  if (!result.success || !Array.isArray(result.data?.connections)) {
    showStatus(accountError(result, "Could not load accounts"), "error");
    await pause();
    return;
  }

  const initial = key.allowedConnections || [];
  const labels = new Map();
  for (const account of result.data.connections) {
    const provider = account.providerSpecificData?.nodeName || account.provider;
    const name = account.name || account.displayName;
    const label = name && account.email && name !== account.email
      ? `${name} · ${account.email}`
      : name || account.email || account.id;
    labels.set(account.id, `${provider} · ${label}`);
  }
  for (const id of initial) {
    if (!labels.has(id)) labels.set(id, `Deleted account: ${id}`);
  }
  const current = initial.length ? initial.map(id => labels.get(id)).join(", ") : "All accounts";
  console.log(`Allowed accounts: ${current}`);
  if (!labels.size) {
    showStatus("No accounts available", "info");
    await pause();
    return;
  }

  const selected = await multiSelect({
    message: "Choose accounts",
    hint: "Space to toggle, Enter to save. Empty selection allows all accounts.",
    emptyError: "All accounts",
    initial,
    choices: Array.from(labels, ([id, label]) => ({ name: id, message: label })),
  });
  if (selected === null) return;

  const saved = await api.setAllowedAccounts(key.id, selected);
  if (saved.success) {
    key.allowedConnections = selected;
    showStatus("Updated", "success");
  } else {
    showStatus(accountError(saved, "Could not save allowed accounts"), "error");
  }
  await pause();
}

/**
 * Show actions for a specific key
 * @param {Object} key - API key object
 * @param {number} port - Server port
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showKeyActions(key, port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  await showMenuWithBack({
    title: `🔑 ${key.name}`,
    breadcrumb: [...breadcrumb, key.name],
    headerContent: `Name: ${key.name}\nKey: ${maskKey(key.key)}\nEndpoint: ${endpoint}`,
    items: [
      {
        label: "Copy to Clipboard",
        action: async () => {
          await handleCopyKey(key);
          return true;
        }
      },
      {
        label: "Allowed accounts",
        action: () => handleAllowedAccounts(key),
      },
      {
        label: "Delete Key",
        action: async () => {
          await handleDeleteKey(key);
          return false; // Exit after delete
        }
      }
    ]
  });
}

/**
 * Main API Keys menu
 * @param {number} port - Server port number
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showApiKeysMenu(port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  while (true) {
    const result = await api.getApiKeys();
    if (!result.success) {
      clearScreen();
      showStatus(accountError(result, "Failed to fetch API keys"), "error");
      await pause();
      return;
    }
    const keys = result.data.keys || [];
    const actions = [
      { label: "← Back" },
      { label: "Create New API Key", run: handleCreateKey },
      ...(keys.length ? [{ label: "Rotate Key (by number)", run: () => handleRotateKey(keys) }] : []),
      ...keys.map(key => ({
        label: `${key.name} (${maskKey(key.key)})`,
        run: () => showKeyActions(key, port, breadcrumb),
      })),
    ];
    const choice = await selectMenu("🔑 API Keys Management", actions, 0, "", `Endpoint: ${endpoint}`, breadcrumb);
    if (choice <= 0) return;
    await actions[choice].run();
  }
}

module.exports = {
  showApiKeysMenu
};
