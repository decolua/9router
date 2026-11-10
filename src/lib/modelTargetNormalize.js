import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import { getStudioModel } from "@/lib/db/repos/modelEditorRepo.js";
import { resolveProviderAlias } from "open-sse/services/model.js";

/**
 * A picked model arrives as `prefix/model` where prefix is either a built-in
 * provider alias or a custom provider node prefix. Resolve the prefix to the
 * provider id the router actually uses so the alias resolves on its own.
 * A bare name that matches a combo or a studio model passes through as the
 * combo/studio target; anything else bare is returned for the validator.
 */
export async function normalizeTarget(targetModel) {
  if (!targetModel.includes("/")) {
    try {
      const { getComboByName } = await import("@/lib/db/repos/combosRepo.js");
      if (await getComboByName(targetModel)) return targetModel;
    } catch {
      /* combo lookup is best-effort */
    }
    const chained = await getStudioModel(targetModel);
    if (chained) return chained.targetModel;
    return targetModel;
  }
  const firstSlash = targetModel.indexOf("/");
  if (firstSlash <= 0) return targetModel;
  const prefix = targetModel.slice(0, firstSlash);
  const rest = targetModel.slice(firstSlash + 1);
  try {
    const nodes = await getProviderNodes();
    const matched = nodes.find((node) => node.prefix === prefix || node.id === prefix);
    if (matched) return `${matched.id}/${rest}`;
  } catch {
    /* node lookup is best-effort */
  }
  return `${resolveProviderAlias(prefix)}/${rest}`;
}
