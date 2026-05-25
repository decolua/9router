import { getProviderConnections, updateProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { probeProviderConnection } from "./providerProbe";

const CONCURRENCY = 5;
const PROBE_TIMEOUT_MS = 5000;

/**
 * Validate all active provider connections at server startup.
 * Non-blocking — results are written to DB; startup proceeds regardless.
 *
 * @returns {Promise<{total: number, valid: number, failed: number, skipped: number}|undefined>}
 */
export async function validateProvidersOnStartup() {
  let connections;
  try {
    connections = await getProviderConnections({ isActive: true });
  } catch (e) {
    console.warn("[9Router] Startup validation: DB not ready, skipping.", e.message);
    return;
  }

  if (!connections || connections.length === 0) return;

  const results = [];

  for (let i = 0; i < connections.length; i += CONCURRENCY) {
    const batch = connections.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (conn) => {
        const probe = await probeProviderConnection(conn, PROBE_TIMEOUT_MS);

        if (!probe.skipped) {
          try {
            await updateProviderConnection(conn.id, {
              testStatus: probe.valid ? "success" : "failed",
              lastTested: new Date().toISOString(),
              lastError: probe.error ?? null,
              lastErrorAt: probe.valid ? null : new Date().toISOString(),
              errorCode: probe.statusCode ?? null,
            });
          } catch (dbErr) {
            console.warn(
              `[9Router] Could not save validation result for ${conn.provider}:`,
              dbErr.message
            );
          }
        }

        return { id: conn.id, provider: conn.provider, name: conn.name, ...probe };
      })
    );

    for (const r of batchResults) {
      const conn = batch[batchResults.indexOf(r)];
      results.push(r.status === "fulfilled" ? r.value : { id: conn?.id, provider: conn?.provider, name: conn?.name, valid: false, skipped: false, error: String(r.reason) });
    }
  }

  const valid = results.filter((r) => r.valid && !r.skipped).length;
  const failed = results.filter((r) => !r.valid && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total = connections.length;

  console.log(
    `[9Router] Startup provider validation: ${valid} ok, ${failed} failed, ${skipped} skipped (${total} total)`
  );

  if (failed > 0) {
    const failedNames = results
      .filter((r) => !r.valid && !r.skipped)
      .map((r) => `${r.provider}${r.name ? `(${r.name})` : ""}${r.error ? `: ${r.error}` : ""}`)
      .join(", ");
    console.warn(`[9Router] Failed providers at startup: ${failedNames}`);
  }

  return { total, valid, failed, skipped };
}
