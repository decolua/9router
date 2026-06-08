const api = require("../api/client");
const { prompt, confirm, pause, select } = require("../utils/input");
const { clearScreen, showBox, showStatus, showHeader } = require("../utils/display");
const { showMenuWithBack, showListMenu } = require("../utils/menuHelper");
const { selectModelFromList } = require("../utils/modelSelector");

// ANSI color codes
const COLORS = {
  reset: "\x1b[0m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
  info: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m"
};

const PROVIDER_MODELS = {
  cc: [
    { id: "claude-sonnet-4-20250514" },
    { id: "claude-opus-4-20250514" },
    { id: "claude-3-5-sonnet-20241022" },
  ],
  cx: [
    { id: "grok-3-mini" },
    { id: "grok-3" },
    { id: "grok-2-vision" },
    { id: "grok-2" },
    { id: "grok-vision-beta" },
    { id: "grok-beta" },
    { id: "grok-2-vision-1212" },
    { id: "grok-2-1212" },
    { id: "dall-e-3" },
  ],
  gc: [
    { id: "gemini-3-pro-preview" },
    { id: "gemini-2.5-pro" },
    { id: "gemini-2.5-flash" },
    { id: "gemini-2.5-flash-lite" },
  ],
  qw: [
    { id: "qwen-max" },
    { id: "qwen-plus" },
    { id: "qwen-turbo" },
    { id: "qwq-32b" },
    { id: "qvq-max" },
  ],
  if: [
    { id: "gpt-4o" },
    { id: "gpt-4o-mini" },
    { id: "gpt-4-turbo" },
    { id: "o1" },
    { id: "o1-mini" },
  ],
  ag: [
    { id: "deepseek-chat" },
    { id: "deepseek-reasoner" },
    { id: "deepseek-v3" },
    { id: "deepseek-r1" },
  ],
  gh: [
    { id: "gpt-4o" },
    { id: "gpt-4o-mini" },
    { id: "gpt-4-turbo" },
    { id: "o1" },
    { id: "o1-mini" },
  ],
  kr: [
    { id: "claude-sonnet-4-20250514" },
    { id: "claude-opus-4-20250514" },
    { id: "claude-3-5-sonnet-20241022" },
  ],
  openai: [
    { id: "gpt-4o" },
    { id: "gpt-4o-mini" },
    { id: "gpt-4-turbo" },
    { id: "o1" },
    { id: "o1-mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514" },
    { id: "claude-opus-4-20250514" },
    { id: "claude-3-5-sonnet-20241022" },
  ],
  gemini: [
    { id: "gemini-3-pro-preview" },
    { id: "gemini-2.5-pro" },
    { id: "gemini-2.5-flash" },
    { id: "gemini-2.5-flash-lite" },
  ],
  openrouter: [
    { id: "auto" },
  ],
  glm: [
    { id: "glm-4.7" },
    { id: "glm-4.6v" },
  ],
  kimi: [
    { id: "kimi-latest" },
  ],
  minimax: [
    { id: "MiniMax-M2.1" },
  ],
};

const OAUTH_PROVIDERS = {
  cc: { name: "Claude Code", clientId: "9fca00eb-0bf5-4f42-9cbb-953a67696bf9", authMode: "oAuth" },
  cx: { name: "xAI (Grok)", clientId: "b391a315-28ae-4cb6-96df-6c1e2b662e96", authMode: "oAuth" },
  gc: { name: "Google Gemini", clientId: "1062743025473-04c3rgdugnh5q4rkti092o4376chb7h3.apps.googleusercontent.com", authMode: "oAuth" },
  qw: { name: "Qwen (Alibaba)", clientId: "9fca00eb-0bf5-4f42-9cbb-953a67696bf9", authMode: "oAuth" },
  if: { name: "Inflection AI", clientId: "9fca00eb-0bf5-4f42-9cbb-953a67696bf9", authMode: "oAuth" },
  ag: { name: "Antigravity (DeepSeek)", clientId: "9fca00eb-0bf5-4f42-9cbb-953a67696bf9", authMode: "oAuth" },
  kr: { name: "KraterCloud (Claude)", clientId: "9fca00eb-0bf5-4f42-9cbb-953a67696bf9", authMode: "oAuth" },
};

const APIKEY_PROVIDERS = {
  gh: { name: "GitHub Models (OpenAI)", authMode: "apiKey", apiBase: "https://models.inference.ai.azure.com" },
  openai: { name: "OpenAI", authMode: "apiKey", apiBase: "https://api.openai.com" },
  anthropic: { name: "Anthropic", authMode: "apiKey", apiBase: "https://api.anthropic.com" },
  gemini: { name: "Google Gemini (API Key)", authMode: "apiKey", apiBase: "https://generativelanguage.googleapis.com" },
  openrouter: { name: "OpenRouter", authMode: "apiKey", apiBase: "https://openrouter.ai/api" },
  glm: { name: "GLM (Zhipu AI)", authMode: "apiKey", apiBase: "https://open.bigmodel.cn/api/paas/v4" },
  kimi: { name: "Kimi (Moonshot AI)", authMode: "apiKey", apiBase: "https://api.moonshot.cn/v1" },
  minimax: { name: "MiniMax", authMode: "apiKey", apiBase: "https://api.minimaxi.com/v1" },
};

function countConnectionsByProvider(connections) {
  const counts = {};
  (connections || []).forEach(conn => {
    const providerId = conn.providerId || conn.provider;
    counts[providerId] = (counts[providerId] || 0) + 1;
  });
  return counts;
}

async function showProvidersMenu(breadcrumb = []) {
  const providerItems = [];

  // Add OAuth providers
  Object.entries(OAUTH_PROVIDERS).forEach(([id, provider]) => {
    providerItems.push({
      label: `${provider.name}`,
      action: async () => {
        const allConnections = await api.getConnections();
        const connections = (allConnections.success ? allConnections.data.connections || allConnections.data : []).filter(c => (c.providerId || c.provider) === id);
        const breadcrumb = [`Провайдеры`];
        await showProviderDetail(id, "oAuth", connections, breadcrumb);
      }
    });
  });

  // Add API Key providers
  Object.entries(APIKEY_PROVIDERS).forEach(([id, provider]) => {
    providerItems.push({
      label: `${provider.name} (API Key)`,
      action: async () => {
        const allConnections = await api.getConnections();
        const connections = (allConnections.success ? allConnections.data.connections || allConnections.data : []).filter(c => (c.providerId || c.provider) === id);
        const breadcrumb = [`Провайдеры`];
        await showProviderDetail(id, "apiKey", connections, breadcrumb);
      }
    });
  });

  providerItems.push({ label: "─" });
  providerItems.push({
    label: "Пользовательские провайдеры (API Key)",
    action: async () => {
      await showCustomProvidersMenu([...breadcrumb, "Пользовательские"]);
    }
  });

  await showMenuWithBack({
    title: "🔌 Управление провайдерами",
    breadcrumb,
    refresh: async () => {
      const result = await api.getConnections();
      const connections = result.success ? (result.data.connections || result.data || []) : [];
      const counts = countConnectionsByProvider(connections);
      return {
        headerContent: [
          `Всего подключений: ${connections.length}`,
          ...Object.entries(counts).map(([id, count]) => `  ${OAUTH_PROVIDERS[id]?.name || APIKEY_PROVIDERS[id]?.name || id}: ${count} подключено`)
        ].join("\n")
      };
    },
    items: providerItems
  });
}

function buildProviderHeader(providerId) {
  const oauth = OAUTH_PROVIDERS[providerId];
  const apikey = APIKEY_PROVIDERS[providerId];
  const provider = oauth || apikey;
  if (!provider) return "";
  
  let header = `Провайдер: ${provider.name}\n`;
  header += `Тип авторизации: ${oauth ? "OAuth" : "API Key"}`;
  if (apikey?.apiBase) header += `\nAPI Base: ${apikey.apiBase}`;
  if (PROVIDER_MODELS[providerId]) {
    header += `\nМодели: ${PROVIDER_MODELS[providerId].map(m => m.id).join(", ")}`;
  }
  return header;
}

async function showProviderDetail(providerId, authType, allConnections, breadcrumb = []) {
  const headerContent = buildProviderHeader(providerId);
  
  await showListMenu({
    title: `🔌 ${OAUTH_PROVIDERS[providerId]?.name || APIKEY_PROVIDERS[providerId]?.name || providerId}`,
    breadcrumb,
    headerContent,
    fetchItems: async () => {
      const result = await api.getConnections();
      const connections = (result.success ? result.data.connections || result.data : [])
        .filter(c => (c.providerId || c.provider) === providerId);
      return { items: connections };
    },
    formatItem: (conn) => `${conn.name || conn.email || conn.id}`,
    onSelect: async (conn) => {
      await showConnectionActions(conn, providerId, [...breadcrumb, conn.name || conn.email || conn.id]);
    },
    createAction: {
      label: "Добавить новое подключение",
      action: async () => {
        await handleAddConnection(providerId, authType);
      }
    }
  });
}

async function showConnectionActions(connection, providerId, breadcrumb = []) {
  await showMenuWithBack({
    title: `🔌 ${connection.name || connection.email || connection.id}`,
    breadcrumb,
    headerContent: [
      `Провайдер: ${OAUTH_PROVIDERS[providerId]?.name || APIKEY_PROVIDERS[providerId]?.name || providerId}`,
      `Статус: ${connection.enabled ? "✅ Активен" : "⛔ Отключён"}`,
      connection.email ? `Email: ${connection.email}` : "",
      `Модели: ${connection.models?.length ? connection.models.map(m => typeof m === "string" ? m : m.id || m.model).join(", ") : "По умолчанию"}`
    ].filter(Boolean).join("\n"),
    items: [
      {
        label: `${connection.enabled ? "Отключить" : "Включить"}`,
        action: async () => {
          if (connection.enabled) {
            const result = await api.disableConnection(connection.id || connection._id);
            if (result.success) showStatus("Подключение отключено", "success");
            else showStatus(`Ошибка: ${result.error}`, "error");
          } else {
            const result = await api.enableConnection(connection.id || connection._id);
            if (result.success) showStatus("Подключение включено", "success");
            else showStatus(`Ошибка: ${result.error}`, "error");
          }
          return false;
        }
      },
      {
        label: "Переименовать",
        action: async () => {
          const newName = await prompt("Новое имя: ");
          if (newName) {
            const result = await api.updateConnection(connection.id || connection._id || connection.key, { name: newName });
            if (result.success) showStatus("Имя обновлено", "success");
            else showStatus(`Ошибка: ${result.error}`, "error");
          }
          return false;
        }
      },
      {
        label: "Удалить подключение",
        action: async () => {
          const confirmed = await confirm("Вы уверены, что хотите удалить это подключение?");
          if (confirmed) {
            const result = await api.deleteConnection(connection.id || connection._id);
            if (result.success) showStatus("Подключение удалено", "success");
            else showStatus(`Ошибка: ${result.error}`, "error");
          }
          return false;
        }
      }
    ]
  });
}

async function handleAddConnection(providerId, authType) {
  if (authType === "apiKey") {
    await handleAddApiKeyConnection(providerId);
  } else {
    // Try OAuth first, fall back to Device Code
    const oauthResult = await handleAddOAuthConnection(providerId);
    if (!oauthResult) {
      await handleAddDeviceCodeConnection(providerId);
    }
  }
}

async function handleAddApiKeyConnection(providerId) {
  const config = APIKEY_PROVIDERS[providerId];
  if (!config) return;
  
  console.log(`\n📝 Добавить ${config.name}`);
  console.log("─".repeat(30));
  console.log(`API Base: ${config.apiBase}`);
  
  const apiKey = await prompt("API Key: ");
  if (!apiKey) {
    showStatus("API Key не может быть пустым", "error");
    return;
  }
  
  showStatus("Добавление провайдера...", "info");
  
  const result = await api.createApiKeyProvider({
    providerId,
    apiKey,
    apiBase: config.apiBase,
    name: config.name
  });
  
  if (result.success) {
    showStatus("Провайдер успешно добавлен!", "success");
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }
}

async function handleAddOAuthConnection(providerId) {
  const config = OAUTH_PROVIDERS[providerId];
  if (!config) return false;
  
  const redirectUri = process.platform === "darwin"
    ? "http://127.0.0.1/callback"
    : "http://localhost/callback";
  
  const authUrl = `https://auth.9router.com/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${providerId}`;
  
  console.log(`\n🔗 Авторизация ${config.name}`);
  console.log("─".repeat(40));
  console.log("\n1. Откройте ссылку в браузере:");
  console.log(`   ${COLORS.cyan}${authUrl}${COLORS.reset}`);
  console.log("\n2. Авторизуйтесь и скопируйте код из URL");
  console.log("\nИли нажмите Enter, чтобы открыть браузер автоматически...\n");
  
  await pause();
  openBrowser(authUrl);
  
  const code = await prompt("Введите код авторизации: ");
  if (!code) return false;
  
  try {
    const exchangeResult = await api.exchangeOAuthCode(providerId, {
      code,
      redirectUri,
      clientId: config.clientId
    });
    
    if (exchangeResult.success) {
      showStatus("Авторизация успешна!", "success");
      return true;
    } else {
      showStatus(`Ошибка авторизации: ${exchangeResult.error}`, "error");
      return false;
    }
  } catch (err) {
    showStatus(`Ошибка: ${err.message}`, "error");
    return false;
  }
}

function openBrowser(url) {
  const { exec } = require("child_process");
  const platform = process.platform;
  let cmd;
  if (platform === "darwin") cmd = `open "${url}"`;
  else if (platform === "win32") cmd = `start "" "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => {});
}

async function handleAddDeviceCodeConnection(providerId) {
  console.log(`\n📱 Настройка Device Code для ${OAUTH_PROVIDERS[providerId]?.name || providerId}`);
  console.log("─".repeat(40));
  
  try {
    const deviceResult = await api.getDeviceCode(providerId);
    if (!deviceResult.success || !deviceResult.data) {
      showStatus(`Ошибка получения кода устройства: ${deviceResult.error || "Неизвестная ошибка"}`, "error");
      return;
    }
    
    const { device_code, user_code, verification_uri, interval } = deviceResult.data;
    
    console.log(`\n1. Откройте ${verification_uri}`);
    console.log(`2. Введите код: ${COLORS.bright}${COLORS.cyan}${user_code}${COLORS.reset}`);
    console.log(`\nОжидание авторизации...\n`);
    
    openBrowser(verification_uri);
    
    const pollInterval = (interval || 5) * 1000;
    
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, pollInterval));
      
      try {
        const pollResult = await api.pollOAuthToken(providerId, {
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        });
        
        if (pollResult.success) {
          showStatus("Авторизация успешна!", "success");
          return true;
        } else if (pollResult.error?.includes("authorization_pending")) {
          process.stdout.write(".");
          continue;
        } else if (pollResult.error?.includes("slow_down")) {
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        } else {
          showStatus(`Ошибка: ${pollResult.error || "Неизвестная ошибка"}`, "error");
          return false;
        }
      } catch (err) {
        showStatus(`Ошибка опроса: ${err.message}`, "error");
        return false;
      }
    }
    
    showStatus("Время ожидания истекло", "error");
    return false;
  } catch (err) {
    showStatus(`Ошибка: ${err.message}`, "error");
    return false;
  }
}

async function showCustomProvidersMenu(breadcrumb = []) {
  await showListMenu({
    title: "🔌 Пользовательские провайдеры",
    breadcrumb,
    headerContent: "Провайдеры с собственным API-ключом",
    fetchItems: async () => {
      const result = await api.getCustomNodes();
      if (!result.success) {
        showStatus(`Ошибка: ${result.error}`, "error");
        return null;
      }
      return { items: result.data.nodes || [] };
    },
    formatItem: (node) => `${node.name} (${node.providerId})`,
    onSelect: async (node) => {
      await showCustomNodeDetail(node, [...breadcrumb, node.name]);
    },
    createAction: {
      label: "Добавить пользовательский провайдер",
      action: async () => {
        await handleAddCustomNode();
      }
    }
  });
}

async function showCustomNodeDetail(node, breadcrumb = []) {
  await showMenuWithBack({
    title: `🔌 ${node.name}`,
    breadcrumb,
    headerContent: [
      `ID: ${node.id || node._id}`,
      `Провайдер: ${node.providerId}`,
      node.apiBase ? `API Base: ${node.apiBase}` : "",
      node.apiKey ? `API Key: ${node.apiKey.substring(0, 8)}...` : "",
      `Подключений: ${node.connections?.length || 0}`
    ].filter(Boolean).join("\n"),
    items: [
      {
        label: "Редактировать",
        action: async () => {
          await handleEditCustomNode(node);
          return false;
        }
      },
      {
        label: "Подключения",
        action: async () => {
          await showCustomNodeConnections(node, [...breadcrumb, "Подключения"]);
          return false;
        }
      },
      {
        label: "Удалить",
        action: async () => {
          const confirmed = await confirm("Вы уверены, что хотите удалить этот узел?");
          if (confirmed) {
            const result = await api.deleteCustomNode(node.id || node._id);
            if (result.success) showStatus("Узел удалён", "success");
            else showStatus(`Ошибка: ${result.error}`, "error");
          }
          return false;
        }
      }
    ]
  });
}

async function showCustomNodeConnections(node, breadcrumb = []) {
  await showListMenu({
    title: `🔌 Подключения: ${node.name}`,
    breadcrumb,
    headerContent: `Узел: ${node.name} (${node.providerId})`,
    fetchItems: async () => {
      const result = await api.getCustomNodeConnections(node.id || node._id);
      if (!result.success) return { items: [] };
      return { items: result.data.connections || [] };
    },
    formatItem: (conn) => `${conn.name || conn.email || conn.id}`,
    onSelect: async (conn) => {
      await showConnectionActions(conn, node.id, breadcrumb);
    },
    createAction: {
      label: "Добавить подключение по ключу API",
      action: async () => {
        await handleAddCustomNodeConnection(node);
      }
    }
  });
}

async function handleAddCustomNodeConnection(node) {
  console.log(`\n📝 Добавить подключение к ${node.name}`);
  console.log("─".repeat(30));
  
  const name = await prompt("Имя подключения: ");
  if (!name) {
    showStatus("Имя обязательно", "error");
    return;
  }
  
  const apiKey = await prompt("API Key: ");
  if (!apiKey) {
    showStatus("API Key обязателен", "error");
    return;
  }
  
  const result = await api.createCustomNodeConnection(node.id || node._id, {
    name,
    apiKey,
    providerId: node.providerId
  });
  
  if (result.success) {
    showStatus("Подключение добавлено!", "success");
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }
}

async function handleAddCustomNode() {
  console.log("\n📝 Добавить пользовательский провайдер");
  console.log("─".repeat(30));
  
  const name = await prompt("Название: ");
  if (!name) return;
  
  const providerId = await prompt("ID провайдера (например, my-provider): ");
  if (!providerId) return;
  
  const apiBase = await prompt("API Base URL (https://...): ");
  if (!apiBase) return;
  
  const apiKey = await prompt("API Key (enter to skip): ");
  
  const result = await api.createCustomNode({ name, providerId, apiBase, apiKey: apiKey || undefined });
  
  if (result.success) {
    showStatus("Пользовательский провайдер создан!", "success");
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }
}

async function handleEditCustomNode(node) {
  console.log(`\n📝 Редактировать ${node.name}`);
  console.log("─".repeat(30));
  
  const name = await prompt(`Название (${node.name}): `);
  const providerId = await prompt(`ID провайдера (${node.providerId}): `);
  const apiBase = await prompt(`API Base URL (${node.apiBase || "не задан"}): `);
  const apiKey = await prompt("Новый API Key (enter to keep current): ");
  
  const updates = {};
  if (name) updates.name = name;
  if (providerId) updates.providerId = providerId;
  if (apiBase) updates.apiBase = apiBase;
  if (apiKey) updates.apiKey = apiKey;
  
  if (Object.keys(updates).length === 0) {
    showStatus("Нет изменений", "info");
    return;
  }
  
  const result = await api.updateCustomNode(node.id || node._id, updates);
  
  if (result.success) {
    showStatus("Узел обновлён!", "success");
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }
}

module.exports = {
  showProvidersMenu
};
