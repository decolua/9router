import { NextResponse } from "next/server";
import {
  deleteProxyPool,
  getProviderConnections,
  getProxyPoolById,
  updateProxyPool,
  updateProviderConnection,
} from "@/models";

function normalizeProxyPoolUpdate(body = {}) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return { error: "Name is required" };
    }
    updates.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "proxyUrl")) {
    const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
    if (!proxyUrl) {
      return { error: "Proxy URL is required" };
    }
    updates.proxyUrl = proxyUrl;
  }

  if (Object.prototype.hasOwnProperty.call(body, "noProxy")) {
    updates.noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  }

  if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
    updates.isActive = body?.isActive === true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "strictProxy")) {
    updates.strictProxy = body?.strictProxy === true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "type")) {
    const validTypes = ["http", "vercel"];
    updates.type = validTypes.includes(body?.type) ? body.type : "http";
  }

  return { updates };
}

function countBoundConnections(connections = [], proxyPoolId) {
  return connections.filter((connection) => {
    const psd = connection?.providerSpecificData || {};
    // Check legacy single proxyPoolId
    if (psd.proxyPoolId === proxyPoolId) return true;
    // Check new proxyPoolIds array
    if (Array.isArray(psd.proxyPoolIds) && psd.proxyPoolIds.includes(proxyPoolId)) return true;
    return false;
  }).length;
}

function getBoundConnections(connections = [], proxyPoolId) {
  return connections.filter((connection) => {
    const psd = connection?.providerSpecificData || {};
    // Check legacy single proxyPoolId
    if (psd.proxyPoolId === proxyPoolId) return true;
    // Check new proxyPoolIds array
    if (Array.isArray(psd.proxyPoolIds) && psd.proxyPoolIds.includes(proxyPoolId)) return true;
    return false;
  });
}

// GET /api/proxy-pools/[id] - Get proxy pool
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    return NextResponse.json({ proxyPool });
  } catch (error) {
    console.log("Error fetching proxy pool:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pool" }, { status: 500 });
  }
}

// PUT /api/proxy-pools/[id] - Update proxy pool
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const body = await request.json();
    const normalized = normalizeProxyPoolUpdate(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const updated = await updateProxyPool(id, normalized.updates);
    return NextResponse.json({ proxyPool: updated });
  } catch (error) {
    console.log("Error updating proxy pool:", error);
    return NextResponse.json({ error: "Failed to update proxy pool" }, { status: 500 });
  }
}

// DELETE /api/proxy-pools/[id] - Delete proxy pool
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProxyPoolById(id);

    if (!existing) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const connections = await getProviderConnections();
    const boundConnections = getBoundConnections(connections, id);

    // If pool is bound to connections, deactivate them and clear proxy refs
    if (boundConnections.length > 0) {
      for (const conn of boundConnections) {
        const psd = { ...conn.providerSpecificData };
        // Remove from proxyPoolIds array
        if (Array.isArray(psd.proxyPoolIds)) {
          psd.proxyPoolIds = psd.proxyPoolIds.filter(poolId => poolId !== id);
          if (psd.proxyPoolIds.length === 0) {
            delete psd.proxyPoolIds;
          }
        }
        // Clear legacy field if matches
        if (psd.proxyPoolId === id) {
          delete psd.proxyPoolId;
        }
        delete psd.proxyPoolIndex;

        await updateProviderConnection(conn.id, {
          isActive: false,
          providerSpecificData: psd,
        });
      }
    }

    await deleteProxyPool(id);
    return NextResponse.json({
      success: true,
      deactivatedConnections: boundConnections.length,
    });
  } catch (error) {
    console.log("Error deleting proxy pool:", error);
    return NextResponse.json({ error: "Failed to delete proxy pool" }, { status: 500 });
  }
}
