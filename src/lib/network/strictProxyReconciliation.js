import { shouldForceStrictProxy } from "@/lib/network/strictProxyPolicy";

function needsStrictProxyRepair(connection = {}) {
  if (!shouldForceStrictProxy(connection.provider)) return false;
  const nested = connection.providerSpecificData;
  const nestedStrict = nested && typeof nested === "object" ? nested.strictProxy === true : false;
  return connection.strictProxy !== true || nestedStrict !== true;
}

export async function reconcileStrictProxyConnections({
  listConnections,
  updateConnection,
  log = console,
} = {}) {
  if (typeof listConnections !== "function" || typeof updateConnection !== "function") {
    throw new Error("listConnections and updateConnection are required");
  }

  const connections = await listConnections();
  const rows = Array.isArray(connections) ? connections : [];
  let repaired = 0;

  for (const connection of rows) {
    if (!needsStrictProxyRepair(connection)) continue;
    const providerSpecificData = connection.providerSpecificData && typeof connection.providerSpecificData === "object"
      ? { ...connection.providerSpecificData, strictProxy: true }
      : { strictProxy: true };

    await updateConnection(connection.id, {
      strictProxy: true,
      providerSpecificData,
    });
    repaired += 1;
  }

  const result = { checked: rows.length, repaired };
  log?.info?.(result, "[StrictProxy] reconciliation completed");
  return result;
}
