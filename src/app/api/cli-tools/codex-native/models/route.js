import { getCodexNativeCatalog, getCodexNativeDefaultModel } from "@/lib/codexNative/catalog.js";
import { getInstalledCodexClientVersion } from "@/lib/codexNative/clientVersion.js";
import {
  getCodexNativeMetrics,
  getCodexNativePoolSnapshot,
  refreshCodexNativePoolUsage,
} from "@/lib/codexNative/pool.js";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const requestedVersion = url.searchParams.get("client_version");
    const installedVersion = requestedVersion
      ? null
      : await getInstalledCodexClientVersion({ forceRefresh });
    const clientVersion = requestedVersion || installedVersion?.version;
    if (!clientVersion) {
      return Response.json({
        error: "Codex client version could not be detected; install Codex CLI or provide client_version",
      }, { status: 503 });
    }
    const catalog = await getCodexNativeCatalog({ forceRefresh, clientVersion });
    const accounts = forceRefresh
      ? await refreshCodexNativePoolUsage({ clientVersion })
      : await getCodexNativePoolSnapshot({ clientVersion });
    if (!forceRefresh) refreshCodexNativePoolUsage({ clientVersion }).catch(() => {});

    return Response.json({
      models: catalog.models.map((model) => ({
        ...model,
        eligibleAccountCount: catalog.eligibleConnectionIds?.[model.slug]?.length || 0,
      })),
      accounts,
      defaultModel: getCodexNativeDefaultModel(catalog),
      metrics: getCodexNativeMetrics(),
      catalog: {
        source: catalog.source,
        stale: catalog.stale === true,
        clientVersion: catalog.clientVersion,
        fetchedAt: new Date(catalog.fetchedAt).toISOString(),
        accountCount: catalog.accountCount ?? accounts.length,
        successfulAccountCount: catalog.successfulAccountCount ?? null,
        warnings: catalog.warnings || [],
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 503 });
  }
}
