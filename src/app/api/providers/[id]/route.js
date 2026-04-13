import { NextResponse } from "next/server";
import {
  getProviderConnectionById,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection,
  updateProviderDisabledModels,
} from "@/models";

function normalizeProxyConfig(body = {}) {
  const hasAnyProxyField =
    Object.prototype.hasOwnProperty.call(body, "connectionProxyEnabled") ||
    Object.prototype.hasOwnProperty.call(body, "connectionProxyUrl") ||
    Object.prototype.hasOwnProperty.call(body, "connectionNoProxy");

  if (!hasAnyProxyField) return { hasAnyProxyField: false };

  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return {
      hasAnyProxyField: true,
      error: "Connection proxy URL is required when connection proxy is enabled",
    };
  }

  return {
    hasAnyProxyField: true,
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolUpdate(proxyPoolIdInput) {
  if (proxyPoolIdInput === undefined) {
    return { hasProxyPoolField: false, proxyPoolId: null };
  }

  if (proxyPoolIdInput === null || proxyPoolIdInput === "" || proxyPoolIdInput === "__none__") {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPoolId = String(proxyPoolIdInput).trim();
  if (!proxyPoolId) {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(proxyPoolId);
  if (!proxyPool) {
    return { hasProxyPoolField: true, error: "Proxy pool not found" };
  }

  return { hasProxyPoolField: true, proxyPoolId };
}

function shouldMergeProviderSpecificData(existing, incoming, hasLegacyProxy, hasProxyPoolField) {
  return existing !== undefined || incoming !== undefined || hasLegacyProxy || hasProxyPoolField;
}

// GET /api/providers/[id] - Get single connection
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Hide sensitive fields
    const result = { ...connection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error fetching connection:", error);
    return NextResponse.json({ error: "Failed to fetch connection" }, { status: 500 });
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      priority,
      globalPriority,
      defaultModel,
      isActive,
      apiKey,
      testStatus,
      lastError,
      lastErrorAt,
      providerSpecificData
    } = body;

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolUpdate(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;

    if (
      shouldMergeProviderSpecificData(
        existing.providerSpecificData,
        providerSpecificData,
        proxyConfig.hasAnyProxyField,
        proxyPoolResult.hasProxyPoolField
      )
    ) {
      updateData.providerSpecificData = {
        ...(existing.providerSpecificData || {}),
        ...(providerSpecificData || {}),
      };

      if (proxyConfig.hasAnyProxyField) {
        updateData.providerSpecificData.connectionProxyEnabled = proxyConfig.connectionProxyEnabled;
        updateData.providerSpecificData.connectionProxyUrl = proxyConfig.connectionProxyUrl;
        updateData.providerSpecificData.connectionNoProxy = proxyConfig.connectionNoProxy;
      }

      if (proxyPoolResult.hasProxyPoolField) {
        if (proxyPoolResult.proxyPoolId === null) {
          delete updateData.providerSpecificData.proxyPoolId;
        } else {
          updateData.providerSpecificData.proxyPoolId = proxyPoolResult.proxyPoolId;
        }
      }
    }

    const updated = await updateProviderConnection(id, updateData);

    // Hide sensitive fields
    const result = { ...updated };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error updating connection:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.log("Error deleting connection:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}

// PATCH /api/providers/[id] - Provider-wide model disable mutations
// Body (exactly one variant):
//   { disabledModels: string[] }  — replace the full provider-wide disabled list
//   { disableModel: string }       — idempotent add of a single bare model ID
//   { enableModel: string }        — remove a single bare model ID from the disabled list
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const providerId = connection.provider;
    if (!providerId) {
      return NextResponse.json({ error: "Connection has no provider" }, { status: 400 });
    }

    // Detect which variant(s) the caller provided
    const hasDisabledModels = Object.prototype.hasOwnProperty.call(body, "disabledModels");
    const hasDisableModel = Object.prototype.hasOwnProperty.call(body, "disableModel");
    const hasEnableModel = Object.prototype.hasOwnProperty.call(body, "enableModel");
    const variantCount = [hasDisabledModels, hasDisableModel, hasEnableModel].filter(Boolean).length;

    if (variantCount === 0) {
      return NextResponse.json(
        { error: "Body must contain exactly one of: disabledModels (array), disableModel (string), enableModel (string)" },
        { status: 400 }
      );
    }
    if (variantCount > 1) {
      return NextResponse.json(
        { error: "Body must contain exactly one of: disabledModels, disableModel, enableModel — not multiple" },
        { status: 400 }
      );
    }

    // Current provider-wide disabled list (any one connection is representative per Task 1 invariant)
    const currentDisabled = Array.isArray(connection.providerSpecificData?.disabledModels)
      ? [...connection.providerSpecificData.disabledModels]
      : [];

    let nextDisabled;

    if (hasDisabledModels) {
      if (!Array.isArray(body.disabledModels)) {
        return NextResponse.json({ error: "disabledModels must be an array" }, { status: 400 });
      }
      // Trim, reject blanks, deduplicate
      nextDisabled = [...new Set(
        body.disabledModels
          .filter((m) => typeof m === "string")
          .map((m) => m.trim())
          .filter((m) => m)
      )];
    } else if (hasDisableModel) {
      if (typeof body.disableModel !== "string") {
        return NextResponse.json({ error: "disableModel must be a string" }, { status: 400 });
      }
      const modelId = body.disableModel.trim();
      if (!modelId) {
        return NextResponse.json({ error: "disableModel must not be blank" }, { status: 400 });
      }
      // Idempotent add
      nextDisabled = currentDisabled.includes(modelId)
        ? currentDisabled
        : [...currentDisabled, modelId];
    } else {
      // hasEnableModel
      if (typeof body.enableModel !== "string") {
        return NextResponse.json({ error: "enableModel must be a string" }, { status: 400 });
      }
      const modelId = body.enableModel.trim();
      if (!modelId) {
        return NextResponse.json({ error: "enableModel must not be blank" }, { status: 400 });
      }
      nextDisabled = currentDisabled.filter((m) => m !== modelId);
    }

    const updatedCount = await updateProviderDisabledModels(providerId, nextDisabled);

    return NextResponse.json({
      providerId,
      disabledModels: nextDisabled,
      updatedConnections: updatedCount,
    });
  } catch (error) {
    console.log("Error updating provider disabled models:", error);
    return NextResponse.json({ error: "Failed to update provider disabled models" }, { status: 500 });
  }
}
