import { NextResponse } from "next/server";
import {
  deleteProxyPool,
  getProviderConnections,
  getProxyPoolById,
  updateProxyPool,
} from "@/models";
import { testProxyUrl } from "@/lib/network/proxyTest";

const SUPPORTED_ACTIONS = new Set(["activate", "deactivate", "delete", "test"]);

function countBoundConnections(connections = [], proxyPoolId) {
  return connections.filter((connection) => connection?.providerSpecificData?.proxyPoolId === proxyPoolId).length;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action.trim() : "";
    const ids = Array.isArray(body?.ids)
      ? [...new Set(body.ids.map((id) => String(id || "").trim()).filter(Boolean))]
      : [];

    if (!SUPPORTED_ACTIONS.has(action)) {
      return NextResponse.json({ error: "Unsupported bulk action" }, { status: 400 });
    }

    if (ids.length === 0) {
      return NextResponse.json({ error: "At least one proxy pool ID is required" }, { status: 400 });
    }

    const connections = action === "delete" ? await getProviderConnections() : [];
    const results = [];

    for (const id of ids) {
      const proxyPool = await getProxyPoolById(id);

      if (!proxyPool) {
        results.push({
          id,
          ok: false,
          error: "Proxy pool not found",
        });
        continue;
      }

      if (action === "activate" || action === "deactivate") {
        const updated = await updateProxyPool(id, { isActive: action === "activate" });
        results.push({
          id,
          ok: true,
          proxyPool: updated,
        });
        continue;
      }

      if (action === "delete") {
        const boundConnectionCount = countBoundConnections(connections, id);
        if (boundConnectionCount > 0) {
          results.push({
            id,
            ok: false,
            error: "Proxy pool is currently in use",
            boundConnectionCount,
          });
          continue;
        }

        await deleteProxyPool(id);
        results.push({
          id,
          ok: true,
        });
        continue;
      }

      if (action === "test") {
        const result = await testProxyUrl({ proxyUrl: proxyPool.proxyUrl });
        const now = new Date().toISOString();

        const updated = await updateProxyPool(id, {
          testStatus: result.ok ? "active" : "error",
          lastTestedAt: now,
          lastError: result.ok ? null : (result.error || `Proxy test failed with status ${result.status}`),
          isActive: result.ok,
        });

        results.push({
          id,
          ok: result.ok,
          proxyPool: updated,
          status: result.status,
          statusText: result.statusText || null,
          error: result.error || null,
          elapsedMs: result.elapsedMs || 0,
          testedAt: now,
        });
      }
    }

    const successCount = results.filter((item) => item.ok).length;
    const failureCount = results.length - successCount;

    return NextResponse.json({
      action,
      results,
      summary: {
        total: results.length,
        successCount,
        failureCount,
      },
    });
  } catch (error) {
    console.log("Error processing bulk proxy pool action:", error);
    return NextResponse.json({ error: "Failed to process bulk action" }, { status: 500 });
  }
}
