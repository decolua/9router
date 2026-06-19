const api = require("../api/client");
const { prompt, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { formatDate } = require("../utils/format");
const { selectModelFromList } = require("../utils/modelSelector");
const { showMenuWithBack } = require("../utils/menuHelper");

/**
 * Format model to string (handle both string and object)
 */
function formatModel(model) {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    return model.id || model.name || `${model.provider}/${model.model}` || JSON.stringify(model);
  }
  return String(model);
}

/**
 * Show actions for a specific combo
 * @param {Object} combo - Combo object
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showComboActions(combo, breadcrumb = []) {
  const modelsChain = Array.isArray(combo.models)
    ? combo.models.map(formatModel).join(" → ")
    : "";
  
  await showMenuWithBack({
    title: `🔀 ${combo.name}`,
    breadcrumb: [...breadcrumb, combo.name],
    headerContent: `Имя: ${combo.name}\nМодели: ${modelsChain}`,
    items: [
      {
        label: "Редактировать комбинацию",
        action: async () => {
          await handleEditSingleCombo(combo);
          return true;
        }
      },
      {
        label: "Удалить комбинацию",
        action: async () => {
          await handleDeleteSingleCombo(combo);
          return false; // Exit after delete
        }
      }
    ]
  });
}

/**
 * Handle editing a single combo
 * @param {Object} combo - Combo to edit
 */
async function handleEditSingleCombo(combo) {
  clearScreen();
  console.log(`\n✏️  Редактировать комбинацию: ${combo.name}\n`);
  
  const newName = await prompt(`Новое имя (Enter чтобы оставить "${combo.name}"): `);
  const name = newName || combo.name;
  
  console.log("\nТекущие модели: " + (Array.isArray(combo.models) ? combo.models.map(formatModel).join(" → ") : ""));
  console.log("\nВыберите модели для этой комбинации (добавляйте по одной):");
  
  const models = [];
  let addMore = true;
  
  while (addMore) {
    const currentChain = models.length > 0 ? models.join(" → ") : "Нет";
    const model = await selectModelFromList(`Добавить модель #${models.length + 1}`, `Цепочка: ${currentChain}`);
    
    if (model) {
      models.push(model);
      console.log(`\n✓ Добавлено: ${model}`);
      console.log(`Текущая цепочка: ${models.join(" → ")}\n`);
      
      const continueAdding = await confirm("Добавить ещё модель?");
      addMore = continueAdding;
    } else {
      addMore = false;
    }
  }
  
  // Use new models if any were added, otherwise keep current
  const finalModels = models.length > 0 ? models : combo.models;
  
  const result = await api.updateCombo(combo.id, { name, models: finalModels });
  
  if (result.success) {
    showStatus("Комбинация обновлена!", "success");
  } else {
    showStatus(`Ошибка обновления: ${result.error}`, "error");
  }
  await pause();
}

/**
 * Handle deleting a single combo
 * @param {Object} combo - Combo to delete
 */
async function handleDeleteSingleCombo(combo) {
  const confirmed = await confirm(`Удалить комбинацию "${combo.name}"?`);
  if (confirmed) {
    const result = await api.deleteCombo(combo.id);
    if (result.success) {
      showStatus("Комбинация удалена!", "success");
    } else {
      showStatus(`Ошибка удаления: ${result.error}`, "error");
    }
    await pause();
  }
}

/**
 * Main combos menu - list all combos and actions
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showCombosMenu(breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");
  
  await showListMenu({
    title: "🔀 Управление комбинациями",
    breadcrumb,
    fetchItems: async () => {
      const result = await api.getCombos();
      if (!result.success) {
        clearScreen();
        showStatus(`Ошибка загрузки комбинаций: ${result.error}`, "error");
        await pause();
        return null;
      }
      return { items: result.data.combos || [] };
    },
    formatItem: (combo) => {
      const modelsChain = Array.isArray(combo.models) ? combo.models.map(formatModel).join(" → ") : "";
      const maxLen = 35;
      const displayModels = modelsChain.length > maxLen
        ? modelsChain.substring(0, maxLen - 3) + "..."
        : modelsChain;
      return `${combo.name}: ${displayModels}`;
    },
    onSelect: async (combo) => {
      await showComboActions(combo, breadcrumb);
    },
    createAction: {
      label: "Создать новую комбинацию",
      action: async () => {
        await handleCreateCombo();
      }
    }
  });
}

/**
 * Show combo detail with stats
 */
async function showComboDetail(comboId) {
  clearScreen();
  
  const result = await api.getComboById(comboId);
  
  if (!result.success) {
    showStatus(`Ошибка загрузки комбинации: ${result.error}`, "error");
    await pause();
    return;
  }
  
  const combo = result.data;
  
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log(`│  🔀 Комбинация: ${combo.name.padEnd(46)} │`);
  console.log("├─────────────────────────────────────────────────────────┤");
  console.log("│                                                          │");
  console.log(`│  ID: ${combo.id.padEnd(51)} │`);
  console.log(`│  Создана: ${formatDate(combo.createdAt).padEnd(46)} │`);
  console.log(`│  Обновлена: ${formatDate(combo.updatedAt).padEnd(46)} │`);
  console.log("│                                                          │");
  console.log("│  Цепочка моделей:                                       │");
  
  // Models is array of strings like ["ag/claude-sonnet-4-5", "kr/claude-sonnet-4.5"]
  const models = Array.isArray(combo.models) ? combo.models : [];
  models.forEach((modelStr, index) => {
    const arrow = index < models.length - 1 ? " →" : "  ";
    const displayText = `${index + 1}. ${modelStr}${arrow}`;
    const padding = Math.max(0, 54 - displayText.length);
    console.log(`│    ${displayText}${" ".repeat(padding)} │`);
  });
  
  console.log("│                                                          │");
  console.log("└─────────────────────────────────────────────────────────┘");
  
  await pause();
}

/**
 * Format combo for menu display
 */
function formatComboLabel(combo) {
  const modelsChain = Array.isArray(combo.models) ? combo.models.map(formatModel).join(" → ") : "";
  const maxLen = 40;
  const displayModels = modelsChain.length > maxLen 
    ? modelsChain.substring(0, maxLen - 3) + "..." 
    : modelsChain;
  return `${combo.name}: ${displayModels}`;
}

/**
 * Create new combo
 */
async function handleCreateCombo() {
  clearScreen();
  
  showStatus("Создание новой комбинации", "info");
  console.log();
  
  // Get combo name
  const name = await prompt("Имя комбинации: ");
  if (!name) {
    showStatus("Имя комбинации обязательно", "error");
    await pause();
    return;
  }
  
  // Fetch available models
  showStatus("Загрузка доступных моделей...", "info");
  const modelsResult = await api.getModels();
  
  if (!modelsResult.success) {
    showStatus(`Ошибка загрузки моделей: ${modelsResult.error}`, "error");
    await pause();
    return;
  }
  
  const availableModels = modelsResult.data.models || [];
  
  if (availableModels.length === 0) {
    showStatus("Нет доступных моделей. Сначала добавьте провайдеров.", "warning");
    await pause();
    return;
  }
  
  // Select models for chain
  const selectedModels = [];
  
  console.log();
  showStatus("Выберите модели для цепочки (минимум 2)", "info");
  
  while (true) {
    clearScreen();
    console.log(`Создание комбинации: ${name}`);
    console.log(`Выбрано моделей (${selectedModels.length}):`);
    
    if (selectedModels.length > 0) {
      selectedModels.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.provider}/${m.model}`);
      });
    } else {
      console.log("  (нет)");
    }
    
    console.log();
    console.log("Доступные модели:");
    availableModels.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.provider}/${m.model}`);
    });
    
    console.log();
    console.log("Действия:");
    console.log("  - Введите номер, чтобы добавить модель");
    console.log("  - Введите 'done' для завершения (минимум 2 модели)");
    console.log("  - Введите 'cancel' для отмены");
    
    const input = await prompt("\nДействие: ");
    
    if (input.toLowerCase() === "cancel") {
      showStatus("Отменено", "warning");
      await pause();
      return;
    }
    
    if (input.toLowerCase() === "done") {
      if (selectedModels.length < 2) {
        showStatus("Выберите как минимум 2 модели", "error");
        await pause();
        continue;
      }
      break;
    }
    
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > availableModels.length) {
      showStatus("Неверный номер модели", "error");
      await pause();
      continue;
    }
    
    selectedModels.push(availableModels[num - 1]);
  }
  
  // Create combo
  showStatus("Создание комбинации...", "info");
  
  const createResult = await api.createCombo({
    name,
    models: selectedModels
  });
  
  if (!createResult.success) {
    showStatus(`Ошибка создания комбинации: ${createResult.error}`, "error");
    await pause();
    return;
  }
  
  showStatus(`Комбинация "${name}" успешно создана!`, "success");
  await pause();
}

/**
 * Edit combo - select which combo to edit
 */
async function handleEditCombo(combos) {
  if (combos.length === 0) {
    showStatus("Нет доступных комбинаций", "warning");
    await pause();
    return;
  }
  
  let selectedCombo = null;
  
  await showMenuWithBack({
    title: "✏️  Выберите комбинацию для редактирования",
    items: combos.map(combo => ({
      label: formatComboLabel(combo),
      action: async () => {
        selectedCombo = combo;
        return false;
      }
    }))
  });
  
  if (!selectedCombo) return;
  await editSingleCombo(selectedCombo);
}

/**
 * Edit a single combo
 */
async function editSingleCombo(combo) {
  clearScreen();
  showStatus(`Редактирование комбинации: ${combo.name}`, "info");
  console.log();
  
  const newName = await prompt(`Новое имя (текущее: ${combo.name}, Enter чтобы оставить): `);
  const editModels = await confirm("Редактировать цепочку моделей?");
  
  let newModels = combo.models;
  
  if (editModels) {
    newModels = [];
    
    while (true) {
      clearScreen();
      console.log(`Редактирование комбинации: ${combo.name}`);
      console.log(`Выбрано моделей (${newModels.length}):`);
      
      if (newModels.length > 0) {
        newModels.forEach((m, i) => { console.log(`  ${i + 1}. ${m}`); });
      } else {
        console.log("  (нет)");
      }
      
      console.log("\nВведите 'done' для завершения (минимум 2 модели) или 'cancel' для отмены\n");
      
      const model = await selectModelFromList("Добавить модель", "");
      
      if (model === null) {
        showStatus("Отменено", "warning");
        await pause();
        return;
      }
      
      if (model === "done") {
        if (newModels.length < 2) {
          showStatus("Выберите как минимум 2 модели", "error");
          await pause();
          continue;
        }
        break;
      }
      
      newModels.push(model);
      showStatus(`Добавлено: ${model}`, "success");
      await pause();
    }
  }
  
  const updateData = {};
  if (newName) updateData.name = newName;
  if (editModels) updateData.models = newModels;
  
  if (Object.keys(updateData).length === 0) {
    showStatus("Изменений не внесено", "warning");
    await pause();
    return;
  }
  
  showStatus("Обновление комбинации...", "info");
  
  const updateResult = await api.updateCombo(combo.id, updateData);
  
  if (!updateResult.success) {
    showStatus(`Ошибка обновления комбинации: ${updateResult.error}`, "error");
    await pause();
    return;
  }
  
  showStatus("Комбинация успешно обновлена!", "success");
  await pause();
}

/**
 * Delete combo - select which combo to delete
 */
async function handleDeleteCombo(combos) {
  if (combos.length === 0) {
    showStatus("Нет доступных комбинаций", "warning");
    await pause();
    return;
  }
  
  let selectedCombo = null;
  
  await showMenuWithBack({
    title: "🗑️  Выберите комбинацию для удаления",
    items: combos.map(combo => ({
      label: formatComboLabel(combo),
      action: async () => {
        selectedCombo = combo;
        return false;
      }
    }))
  });
  
  if (!selectedCombo) return;
  
  clearScreen();
  showStatus(`Комбинация: ${selectedCombo.name}`, "warning");
  const modelsDisplay = Array.isArray(selectedCombo.models)
    ? selectedCombo.models.map(formatModel).join(" → ")
    : "";
  console.log(`Модели: ${modelsDisplay}`);
  console.log();
  
  const confirmed = await confirm("Вы уверены, что хотите удалить эту комбинацию?");
  
  if (!confirmed) {
    showStatus("Отменено", "info");
    await pause();
    return;
  }
  
  showStatus("Удаление комбинации...", "info");
  
  const deleteResult = await api.deleteCombo(selectedCombo.id);
  
  if (!deleteResult.success) {
    showStatus(`Ошибка удаления комбинации: ${deleteResult.error}`, "error");
    await pause();
    return;
  }
  
  showStatus("Комбинация успешно удалена!", "success");
  await pause();
}

module.exports = { showCombosMenu };
