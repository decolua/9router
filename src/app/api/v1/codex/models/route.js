import { getProviderConnections } from "@/lib/localDb";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { resolveCodexCatalog } from "open-sse/services/codexCatalog.js";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

// Codex CLI clients parse {"models":[...]} and silently fall back to their own
// bundled (stale) metadata when handed the OpenAI {object,data} list instead.
// This is the catalog contract codex-lb serves at /backend-api/codex/models,
// sourced from 9router's own Codex connections rather than a separate pool.
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const forceRefresh = params.get("refresh") === "1";

    let connections = [];
    try {
      connections = (await getProviderConnections()).filter(
        (c) => c.provider === "codex" && c.isActive !== false && c.accessToken,
      );
    } catch {
      // DB unavailable — resolveCodexCatalog still serves the persisted snapshot.
    }

    const proxyByConnection = new Map();
    for (const conn of connections) {
      try {
        const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
        proxyByConnection.set(conn.id, {
          connectionProxyEnabled: proxy.connectionProxyEnabled === true,
          connectionProxyUrl: proxy.connectionProxyUrl || "",
          connectionNoProxy: proxy.connectionNoProxy || "",
          vercelRelayUrl: proxy.vercelRelayUrl || "",
          strictProxy: proxy.strictProxy === true,
        });
      } catch {
        proxyByConnection.set(conn.id, null);
      }
    }

    const catalog = await resolveCodexCatalog({
      connections,
      forceRefresh,
      proxyOptionsFor: (conn) => proxyByConnection.get(conn.id) || null,
      onCredentialsRefreshed: async (conn, refreshed) => {
        await updateProviderCredentials(conn.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          idToken: refreshed.idToken,
          expiresIn: refreshed.expiresIn,
        });
      },
    });

    const created = Math.floor(Date.now() / 1000);
    const data = catalog.models
      .filter((m) => m?.supported_in_api !== false && m?.visibility === "list")
      .map((m) => ({
        id: m.slug,
        object: "model",
        created,
        owned_by: "codex",
        ...(Number.isFinite(m.context_window) ? { context_length: m.context_window } : {}),
      }));

    return Response.json(
      {
        models: catalog.models,
        object: "list",
        data,
        source: catalog.source,
        fetched_at: catalog.fetchedAt,
        ...(catalog.warning ? { warning: catalog.warning } : {}),
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}