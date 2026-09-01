import {
  ensureModelInventoryFresh,
} from "../modelInventory/scheduler.js";

import {
  refreshModelInventory,
} from "../modelInventory/service.js";

import {
  generateAutoCombos,
} from "./generator.js";

export async function getAutoComboSnapshot({
  forceInventoryRefresh = false,
  includeDynamic = true,
} = {}) {
  const inventory =
    forceInventoryRefresh
      ? await refreshModelInventory({
          force: true,
          includeDynamic,
        })
      : await ensureModelInventoryFresh();

  return generateAutoCombos(
    inventory,
  );
}

export async function getAutoComboById(
  id,
  options = {},
) {
  const snapshot =
    await getAutoComboSnapshot(
      options,
    );

  return (
    snapshot.combos.find(
      (combo) =>
        combo.id === id,
    ) || null
  );
}
