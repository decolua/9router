const api = require("../api/client");
const { prompt, confirm, pause } = require("../utils/input");
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
  console.log("│  🔑 Управление ключами API                              │");
  console.log("├─────────────────────────────────────────────────────────┤");
  // Note: This function is legacy, endpoint shown in menu header instead
  console.log("│                                                          │");
  
  if (keys.length === 0) {
    console.log("│  Ключи API не найдены.                                  │");
  } else {
    console.log(`│  Ваши ключи API (${keys.length}):${" ".repeat(42 - String(keys.length).length)}│`);
    
    keys.forEach((key, index) => {
      console.log("│                                                          │");
      console.log(`│  ${index + 1}. ${key.name}${" ".repeat(52 - String(index + 1).length - key.name.length)}│`);
      
      const maskedKey = maskKey(key.key);
      console.log(`│     Ключ: ${maskedKey}${" ".repeat(47 - maskedKey.length)}│`);
      
      const created = formatDate(key.createdAt);
      console.log(`│     Создан: ${created}${" ".repeat(43 - created.length)}│`);
      
      if (key.lastUsedAt) {
        const lastUsed = getRelativeTime(key.lastUsedAt);
        console.log(`│     Использован: ${lastUsed}${" ".repeat(41 - lastUsed.length)}│`);
      } else {
        console.log("│     Использован: Никогда                                │");
      }
    });
  }
  
  console.log("│                                                          │");
  console.log("│  Действия:                                              │");
  console.log("│  1. Создать новый ключ API                              │");
  console.log("│  2. Показать полный ключ (по номеру)                    │");
  console.log("│  3. Скопировать ключ в буфер (по номеру)                │");
  console.log("│  4. Удалить ключ (по номеру)                            │");
  console.log("│  0. ← Назад в главное меню                              │");
  console.log("└─────────────────────────────────────────────────────────┘");
}

/**
 * Handle creating new API key
 * @returns {Promise<boolean>} Success status
 */
async function handleCreateKey() {
  console.log("\n📝 Создать новый ключ API");
  console.log("─".repeat(30));
  
  const name = await prompt("Введите имя ключа: ");
  
  if (!name) {
    showStatus("Имя ключа не может быть пустым", "error");
    await pause();
    return false;
  }
  
  const result = await api.createApiKey(name);
  
  if (!result.success) {
    showStatus(`Ошибка создания ключа: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  console.log("\n✅ Ключ API успешно создан!");
  console.log("\n⚠️  ВАЖНО: Сохраните ключ сейчас. Вы не сможете увидеть его снова!");
  console.log(`\nКлюч: ${result.data.key}`);
  console.log(`Имя: ${result.data.name}`);
  console.log(`ID: ${result.data.id}`);
  
  const shouldCopy = await confirm("\nСкопировать ключ в буфер обмена?");
  if (shouldCopy) {
    if (copyToClipboard(result.data.key)) {
      showStatus("Ключ скопирован в буфер обмена!", "success");
    } else {
      showStatus("Не удалось скопировать в буфер обмена", "error");
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
  console.log("\n🔍 Полный ключ API");
  console.log("─".repeat(30));
  console.log(`Имя: ${key.name}`);
  console.log(`Ключ: ${key.key}`);
  console.log(`ID: ${key.id}`);
  console.log(`Создан: ${formatDate(key.createdAt)}`);
  
  if (key.lastUsedAt) {
    console.log(`Использован: ${getRelativeTime(key.lastUsedAt)}`);
  } else {
    console.log("Использован: Никогда");
  }
  
  await pause();
}

/**
 * Handle copying API key to clipboard
 * @param {Object} key - API key object
 */
async function handleCopyKey(key) {
  if (copyToClipboard(key.key)) {
    showStatus(`Ключ "${key.name}" скопирован в буфер обмена!`, "success");
  } else {
    showStatus("Не удалось скопировать в буфер обмена", "error");
  }
  await pause();
}

/**
 * Handle deleting API key
 * @param {Object} key - API key object
 * @returns {Promise<boolean>} Success status
 */
async function handleDeleteKey(key) {
  console.log(`\n⚠️  Удалить ключ API: ${key.name}`);
  console.log("─".repeat(30));
  console.log(`Ключ: ${maskKey(key.key)}`);
  console.log(`Создан: ${formatDate(key.createdAt)}`);
  
  const confirmed = await confirm("\nВы уверены, что хотите удалить этот ключ?");
  
  if (!confirmed) {
    showStatus("Удаление отменено", "info");
    await pause();
    return false;
  }
  
  const result = await api.deleteApiKey(key.id);
  
  if (!result.success) {
    showStatus(`Не удалось удалить ключ: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  showStatus("Ключ API успешно удалён", "success");
  await pause();
  return true;
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
    headerContent: `Имя: ${key.name}\nКлюч: ${key.key}\nАдрес: ${endpoint}`,
    items: [
      {
        label: "Копировать в буфер обмена",
        action: async () => {
          await handleCopyKey(key);
          return true;
        }
      },
      {
        label: "Удалить ключ",
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
  const { showListMenu } = require("../utils/menuHelper");
  
  const { endpoint } = await getEndpoint(port);
  await showListMenu({
    title: "🔑 Управление ключами API",
    breadcrumb,
    headerContent: `Адрес: ${endpoint}`,
    fetchItems: async () => {
      const result = await api.getApiKeys();
      if (!result.success) {
        clearScreen();
        showStatus(`Не удалось получить ключи API: ${result.error}`, "error");
        await pause();
        return null;
      }
      return { items: result.data.keys || [] };
    },
    formatItem: (key) => `${key.name} (${maskKey(key.key)})`,
    onSelect: async (key) => {
      await showKeyActions(key, port, breadcrumb);
    },
    createAction: {
      label: "Создать новый ключ API",
      action: async () => {
        await handleCreateKey();
      }
    }
  });
}

module.exports = {
  showApiKeysMenu
};
