// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { NextResponse } from "next/server";
import { getProviderConnectionById, getProviderConnections } from "@/lib/localDb";
import { makeKv } from "@/lib/db/helpers/kvStore";
import { dailyCheckinCodeBuddy } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";

const checkinKv = makeKv("codebuddy_checkin");

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function executeCheckinForConnection(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  let activeConn = connection;
  try {
    const refreshed = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    if (refreshed?.connection) {
      activeConn = refreshed.connection;
    }
  } catch (err) {
    console.warn(`[Checkin] Token refresh failed for ${connection.id}:`, err.message);
  }

  const result = await dailyCheckinCodeBuddy(
    activeConn.accessToken || activeConn.apiKey,
    activeConn.apiKey,
    activeConn.providerSpecificData,
    proxyOptions
  );

  const today = getTodayString();
  const record = {
    date: today,
    checkedAt: new Date().toISOString(),
    ok: Boolean(result.ok),
    already: Boolean(result.already),
    code: result.code ?? null,
    message: result.message || "",
  };

  await checkinKv.set(connection.id, record);
  return { id: connection.id, name: connection.name || connection.email || connection.id, ...record };
}

export async function GET(_request, { params }) {
  try {
    const { connectionId } = await params;
    const today = getTodayString();

    if (connectionId === "all") {
      const allRecords = await checkinKv.getAll();
      return NextResponse.json({ today, checkins: allRecords || {} });
    }

    const record = await checkinKv.get(connectionId, null);
    return NextResponse.json({ today, checkin: record });
  } catch (error) {
    console.error("[Checkin API GET error]:", error);
    return NextResponse.json({ error: "Failed to fetch checkin status" }, { status: 500 });
  }
}

export async function POST(_request, { params }) {
  try {
    const { connectionId } = await params;

    if (connectionId === "all") {
      const allConnections = await getProviderConnections();
      const cbcnConnections = allConnections.filter(
        (c) => c.provider === "codebuddy-cn" && (c.isActive === undefined || c.isActive === true || c.isActive === 1)
      );

      if (cbcnConnections.length === 0) {
        return NextResponse.json({
          message: "No active CodeBuddy CN connections found",
          results: {},
          summary: { total: 0, success: 0, already: 0, failed: 0 },
        });
      }

      const results = {};
      let success = 0;
      let already = 0;
      let failed = 0;

      for (const conn of cbcnConnections) {
        try {
          const res = await executeCheckinForConnection(conn);
          results[conn.id] = res;
          if (res.already) {
            already += 1;
            success += 1;
          } else if (res.ok) {
            success += 1;
          } else {
            failed += 1;
          }
        } catch (err) {
          results[conn.id] = {
            id: conn.id,
            ok: false,
            already: false,
            message: err.message,
            checkedAt: new Date().toISOString(),
          };
          failed += 1;
        }
      }

      return NextResponse.json({
        success: failed === 0 || success > 0,
        results,
        summary: { total: cbcnConnections.length, success, already, failed },
      });
    }

    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection.provider !== "codebuddy-cn") {
      return NextResponse.json(
        { error: "Daily checkin is only supported for CodeBuddy CN" },
        { status: 400 }
      );
    }

    const result = await executeCheckinForConnection(connection);
    return NextResponse.json({ success: result.ok, result });
  } catch (error) {
    console.error("[Checkin API POST error]:", error);
    return NextResponse.json({ error: error.message || "Checkin failed" }, { status: 500 });
  }
}
