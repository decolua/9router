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
    headerContent: `Name: ${combo.name}\nModels: ${modelsChain}`,
    items: [
      {
        label: "Edit Combo",
        action: async () => {
          await handleEditSingleCombo(combo);
          return true;
        }
      },
      {
        label: "Delete Combo",
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
  console.log(`\n✏️  Edit Combo: ${combo.name}\n`);
  
  const newName = await prompt(`New name (Enter to keep "${combo.name}"): `);
  const name = newName || combo.name;
  
  console.log("\nCurrent models: " + (Array.isArray(combo.models) ? combo.models.map(formatModel).join(" → ") : ""));
  console.log("\nSelect models for this combo (add one by one):");
  
  const models = [];
  let addMore = true;
  
  while (addMore) {
    const currentChain = models.length > 0 ? models.join(" → ") : "None";
    const model = await selectModelFromList(`Add Model #${models.length + 1}`, `Chain: ${currentChain}`);
    
    if (model) {
      models.push(model);
      console.log(`\n✓ Added: ${model}`);
      console.log(`Current chain: ${models.join(" → ")}\n`);
      
      const continueAdding = await confirm("Add another model?");
      addMore = continueAdding;
    } else {
      addMore = false;
    }
  }
  
  // Use new models if any were added, otherwise keep current
  const finalModels = models.length > 0 ? models : combo.models;
  
  const result = await api.updateCombo(combo.id, { name, models: finalModels });
  
  if (result.success) {
    showStatus("Combo updated!", "success");
  } else {
    showStatus(`Update failed: ${result.error}`, "error");
  }
  await pause();
}

/**
 * Handle deleting a single combo
 * @param {Object} combo - Combo to delete
 */
async function handleDeleteSingleCombo(combo) {
  const confirmed = await confirm(`Delete combo "${combo.name}"?`);
  if (confirmed) {
    const result = await api.deleteCombo(combo.id);
    if (result.success) {
      showStatus("Combo deleted!", "success");
    } else {
      showStatus(`Delete failed: ${result.error}`, "error");
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
    title: "🔀 Combos Management",
    breadcrumb,
    fetchItems: async () => {
      const result = await api.getCombos();
      if (!result.success) {
        clearScreen();
        showStatus(`Failed to load combos: ${result.error}`, "error");
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
      label: "Create New Combo",
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
    showStatus(`Failed to load combo: ${result.error}`, "error");
    await pause();
    return;
  }
  
  const combo = result.data;
  
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log(`│  🔀 Combo: ${combo.name.padEnd(46)} │`);
  console.log("├─────────────────────────────────────────────────────────┤");
  console.log("│                                                          │");
  console.log(`│  ID: ${combo.id.padEnd(51)} │`);
  console.log(`│  Created: ${formatDate(combo.createdAt).padEnd(46)} │`);
  console.log(`│  Updated: ${formatDate(combo.updatedAt).padEnd(46)} │`);
  console.log("│                                                          │");
  console.log("│  Model Chain:                                           │");
  
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
  
  showStatus("Create New Combo", "info");
  console.log();
  
  // Get combo name
  const name = await prompt("Combo name: ");
  if (!name) {
    showStatus("Combo name is required", "error");
    await pause();
    return;
  }
  
  // Fetch available models
  showStatus("Loading available models...", "info");
  const modelsResult = await api.getModels();
  
  if (!modelsResult.success) {
    showStatus(`Failed to load models: ${modelsResult.error}`, "error");
    await pause();
    return;
  }
  
  const availableModels = modelsResult.data.models || [];
  
  if (availableModels.length === 0) {
    showStatus("No models available. Please add providers first.", "warning");
    await pause();
    return;
  }
  
  // Select models for chain
  const selectedModels = [];
  
  console.log();
  showStatus("Select models for the chain (minimum 2)", "info");
  
  while (true) {
    clearScreen();
    console.log(`Creating combo: ${name}`);
    console.log(`Selected models (${selectedModels.length}):`);
    
    if (selectedModels.length > 0) {
      selectedModels.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.provider}/${m.model}`);
      });
    } else {
      console.log("  (none)");
    }
    
    console.log();
    console.log("Available models:");
    availableModels.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.provider}/${m.model}`);
    });
    
    console.log();
    console.log("Actions:");
    console.log("  - Enter number to add model");
    console.log("  - Type 'done' to finish (min 2 models)");
    console.log("  - Type 'cancel' to abort");
    
    const input = await prompt("\nAction: ");
    
    if (input.toLowerCase() === "cancel") {
      showStatus("Cancelled", "warning");
      await pause();
      return;
    }
    
    if (input.toLowerCase() === "done") {
      if (selectedModels.length < 2) {
        showStatus("Please select at least 2 models", "error");
        await pause();
        continue;
      }
      break;
    }
    
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > availableModels.length) {
      showStatus("Invalid model number", "error");
      await pause();
      continue;
    }
    
    selectedModels.push(availableModels[num - 1]);
  }
  
  // Create combo
  showStatus("Creating combo...", "info");
  
  const createResult = await api.createCombo({
    name,
    models: selectedModels
  });
  
  if (!createResult.success) {
    showStatus(`Failed to create combo: ${createResult.error}`, "error");
    await pause();
    return;
  }
  
  showStatus(`Combo "${name}" created successfully!`, "success");
  await pause();
}

/**
 * Edit combo - select which combo to edit
 */
async function handleEditCombo(combos) {
  if (combos.length === 0) {
    showStatus("No combos available", "warning");
    await pause();
    return;
  }
  
  let selectedCombo = null;
  
  await showMenuWithBack({
    title: "✏️  Select Combo to Edit",
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
  showStatus(`Editing combo: ${combo.name}`, "info");
  console.log();
  
  const newName = await prompt(`New name (current: ${combo.name}, press Enter to keep): `);
  const editModels = await confirm("Edit model chain?");
  
  let newModels = combo.models;
  
  if (editModels) {
    newModels = [];
    
    while (true) {
      clearScreen();
      console.log(`Editing combo: ${combo.name}`);
      console.log(`Selected models (${newModels.length}):`);
      
      if (newModels.length > 0) {
        newModels.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
      } else {
        console.log("  (none)");
      }
      
      console.log("\nType 'done' to finish (min 2 models) or 'cancel' to abort\n");
      
      const model = await selectModelFromList("Add Model", "");
      
      if (model === null) {
        showStatus("Cancelled", "warning");
        await pause();
        return;
      }
      
      if (model === "done") {
        if (newModels.length < 2) {
          showStatus("Please select at least 2 models", "error");
          await pause();
          continue;
        }
        break;
      }
      
      newModels.push(model);
      showStatus(`Added: ${model}`, "success");
      await pause();
    }
  }
  
  const updateData = {};
  if (newName) updateData.name = newName;
  if (editModels) updateData.models = newModels;
  
  if (Object.keys(updateData).length === 0) {
    showStatus("No changes made", "warning");
    await pause();
    return;
  }
  
  showStatus("Updating combo...", "info");
  
  const updateResult = await api.updateCombo(combo.id, updateData);
  
  if (!updateResult.success) {
    showStatus(`Failed to update combo: ${updateResult.error}`, "error");
    await pause();
    return;
  }
  
  showStatus("Combo updated successfully!", "success");
  await pause();
}

/**
 * Delete combo - select which combo to delete
 */
async function handleDeleteCombo(combos) {
  if (combos.length === 0) {
    showStatus("No combos available", "warning");
    await pause();
    return;
  }
  
  let selectedCombo = null;
  
  await showMenuWithBack({
    title: "🗑️  Select Combo to Delete",
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
  showStatus(`Combo: ${selectedCombo.name}`, "warning");
  const modelsDisplay = Array.isArray(selectedCombo.models) 
    ? selectedCombo.models.map(formatModel).join(" → ") 
    : "";
  console.log(`Models: ${modelsDisplay}`);
  console.log();
  
  const confirmed = await confirm("Are you sure you want to delete this combo?");
  
  if (!confirmed) {
    showStatus("Cancelled", "info");
    await pause();
    return;
  }
  
  showStatus("Deleting combo...", "info");
  
  const deleteResult = await api.deleteCombo(selectedCombo.id);
  
  if (!deleteResult.success) {
    showStatus(`Failed to delete combo: ${deleteResult.error}`, "error");
    await pause();
    return;
  }
  
  showStatus("Combo deleted successfully!", "success");
  await pause();
}

module.exports = { showCombosMenu };
