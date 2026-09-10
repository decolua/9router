import { getCombos } from "@/lib/localDb";

/**
 * Check for circular dependencies in model combos.
 * A circular dependency occurs if combo A includes combo B, and combo B (directly or indirectly) includes combo A.
 * 
 * @param {string} targetName - The name of the combo being created or updated.
 * @param {string[]} models - The list of model/combo names included in this combo.
 * @param {string} [excludeId] - Optional ID to exclude from the existing combos (useful during updates).
 * @returns {Promise<boolean>} True if a circular dependency is detected, false otherwise.
 */
export async function hasCircularDependency(targetName, models, excludeId = null) {
  if (!models || !Array.isArray(models)) return false;

  // 1. If the combo includes itself directly
  if (models.includes(targetName)) return true;

  // 2. Fetch all existing combos to build a map
  const allCombos = await getCombos();
  const comboMap = new Map();
  
  for (const combo of allCombos) {
    // During update, skip the old version of the same combo
    if (excludeId && combo.id === excludeId) continue;
    // Map combo name to its model list
    comboMap.set(combo.name, combo.models || []);
  }

  // 3. Use a stack for Depth-First Search (DFS) to find any path back to targetName
  const stack = [...models];
  const visited = new Set();

  while (stack.length > 0) {
    const current = stack.pop();

    // If we find a reference back to the target combo name
    if (current === targetName) {
      return true;
    }

    // If current is another combo and we haven't visited it yet
    if (comboMap.has(current) && !visited.has(current)) {
      visited.add(current);
      const subModels = comboMap.get(current);
      if (subModels && Array.isArray(subModels)) {
        stack.push(...subModels);
      }
    }
  }

  return false;
}
