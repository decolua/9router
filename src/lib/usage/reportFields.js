import { publicText } from "../../shared/utils/keyOwnership.js";
export { publicText };

export function connectionName(provider, id) {
  if (!id || !publicText(id) || !/^[\w-]+$/.test(id)) return null;
  return (publicText(provider) ?? "Unknown") + " · " + id.slice(0, 8);
}
