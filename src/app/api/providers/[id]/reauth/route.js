// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/lib/providers/refreshCredentials.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/[id]/reauth
 * Force-refresh OAuth credentials in place — keeps id/order/proxy/metadata.
 * Returns 401 when the refresh token itself is dead and a full re-login is
 * needed; the UI then routes to the provider's normal OAuth add flow.
 */
export async function POST(_request, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing connection id" }, { status: 400 });
  }

  let connection;
  try {
    connection = await getProviderConnectionById(id);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Connection not found" }, { status: 404 });
  }
  if (!connection) {
    return NextResponse.json({ ok: false, error: "Connection not found" }, { status: 404 });
  }

  // Resolve connection proxy config; force strictProxy=false so refresh falls back to direct on failure
  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  try {
    const { connection: updated, refreshed } = await refreshAndUpdateCredentials(connection, true, proxyOptions);
    return NextResponse.json({ ok: true, refreshed: !!refreshed, connection: updated });
  } catch (e) {
    const message = e?.message || "Please re-authorize the connection.";
    const status = /re-authorize|re-?login/i.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
