import { NextResponse } from "next/server";
import { getProviderConnections, getModelAliases, getCombos, getApiKeys, createApiKey, updateProviderConnection, updateSettings, getCloudUrl } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import fs from "fs/promises";
import path from "path";
import os from "os";

const CLOUD_SYNC_TIMEOUT_MS = Number(process.env.CLOUD_SYNC_TIMEOUT_MS || 12000);

async function getResolvedCloudUrl() {
  return await getCloudUrl();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CLOUD_SYNC_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * POST /api/sync/cloud
 * Sync data with Cloud
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;
    
    // Always get machineId from server, don't trust client
    const machineId = await getConsistentMachineId();

    switch (action) {
      case "enable":
        await updateSettings({ cloudEnabled: true });
        // Auto create key if none exists
        const keys = await getApiKeys();
        let createdKey = null;
        if (keys.length === 0) {
          createdKey = await createApiKey("Default Key", machineId);
        }
        return syncAndVerify(machineId, createdKey?.key, keys);
      case "sync": {
        const syncResult = await syncToCloud(machineId);
        if (syncResult.error) {
          return NextResponse.json(syncResult, { status: 502 });
        }
        return NextResponse.json(syncResult);
      }
      case "disable":
        await updateSettings({ cloudEnabled: false });
        return handleDisable(machineId, request);
      case "check":
        return handleCheck();
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.log("Cloud sync error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Sync data to Cloud (exported for reuse)
 * @param {string} machineId
 * @param {string|null} createdKey - Key created during enable
 */
export async function syncToCloud(machineId, createdKey = null) {
  const cloudUrl = await getResolvedCloudUrl();
  if (!cloudUrl) {
    return { error: "Cloud URL is not configured" };
  }

  // Get current data from db
  const providers = await getProviderConnections();
  const modelAliases = await getModelAliases();
  const combos = await getCombos();
  const apiKeys = await getApiKeys();

  let response;
  try {
    // Send to Cloud
    response = await fetchWithTimeout(`${cloudUrl}/sync/${machineId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers,
        modelAliases,
        combos,
        apiKeys
      })
    });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return { error: isTimeout ? "Cloud sync timeout" : "Cloud sync request failed" };
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.log("Cloud sync failed:", errorText);
    return { error: "Cloud sync failed" };
  }

  const result = await response.json();

  // Update local db with tokens from Cloud (providers stored by ID)
  if (result.data && result.data.providers) {
    await updateLocalTokens(result.data.providers);
  }

  const responseData = {
    success: true,
    message: "Synced successfully",
    changes: result.changes
  };

  if (createdKey) {
    responseData.createdKey = createdKey;
  }

  return responseData;
}

/**
 * Sync and verify connection with ping
 */
async function syncAndVerify(machineId, createdKey, existingKeys) {
  // Step 1: Sync data to cloud
  const syncResult = await syncToCloud(machineId, createdKey);
  if (syncResult.error) {
    return NextResponse.json(syncResult, { status: 502 });
  }

  // Step 2: Verify connection by pinging the cloud
  const apiKey = createdKey || existingKeys[0]?.key;
  if (!apiKey) {
    return NextResponse.json({
      ...syncResult,
      verified: false,
      verifyError: "No API key available"
    });
  }

  try {
    const cloudUrl = await getResolvedCloudUrl();
    const pingResponse = await fetchWithTimeout(`${cloudUrl}/${machineId}/v1/verify`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (pingResponse.ok) {
      return NextResponse.json({
        ...syncResult,
        verified: true
      });
    } else {
      return NextResponse.json({
        ...syncResult,
        verified: false,
        verifyError: `Ping failed: ${pingResponse.status}`
      });
    }
  } catch (error) {
    return NextResponse.json({
      ...syncResult,
      verified: false,
      verifyError: error.message
    });
  }
}

/**
 * Disable Cloud - delete cache and update Claude CLI settings
 */
async function handleDisable(machineId, request) {
  const cloudUrl = await getResolvedCloudUrl();
  if (!cloudUrl) {
    return NextResponse.json({ error: "Cloud URL is not configured" }, { status: 500 });
  }

  let response;
  try {
    response = await fetchWithTimeout(`${cloudUrl}/sync/${machineId}`, {
      method: "DELETE"
    });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "Cloud disable timeout" : "Failed to reach cloud service" },
      { status: 502 }
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.log("Cloud disable failed:", errorText);
    return NextResponse.json({ error: "Failed to disable cloud" }, { status: 502 });
  }

  // Update Claude CLI settings to use local endpoint
  const host = request.headers.get("host") || "localhost:20128";
  await updateClaudeSettingsToLocal(machineId, host, cloudUrl);

  return NextResponse.json({
    success: true,
    message: "Cloud disabled"
  });
}

/**
 * Update Claude CLI settings to use local endpoint (only if currently using cloud)
 */
async function updateClaudeSettingsToLocal(machineId, host, cloudUrl) {
  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    const cloudEndpoint = `${cloudUrl}/${machineId}`;
    const localUrl = `http://${host}`;

    // Read current settings
    let settings;
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return; // No settings file, nothing to update
      }
      throw error;
    }

    // Check if ANTHROPIC_BASE_URL matches cloud URL
    const currentUrl = settings.env?.ANTHROPIC_BASE_URL;
    if (!currentUrl || currentUrl !== cloudEndpoint) {
      return; // Not using cloud URL, don't modify
    }

    // Update to local URL
    settings.env.ANTHROPIC_BASE_URL = localUrl;
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`Updated Claude CLI settings: ${cloudEndpoint} → ${localUrl}`);
  } catch (error) {
    console.log("Failed to update Claude CLI settings:", error.message);
  }
}

/**
 * Check if cloud worker is reachable
 */
async function handleCheck() {
  const cloudUrl = await getResolvedCloudUrl();
  if (!cloudUrl) {
    return NextResponse.json({ error: "Cloud URL is not configured" }, { status: 400 });
  }

  try {
    const res = await fetchWithTimeout(`${cloudUrl}/health`, { method: "GET" }, 5000);
    if (res.ok) {
      return NextResponse.json({ success: true, message: "Worker is running" });
    }
    return NextResponse.json({ error: `Worker responded with ${res.status}` }, { status: 502 });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return NextResponse.json(
      { error: isTimeout ? "Worker request timeout" : "Cannot reach worker" },
      { status: 502 }
    );
  }
}

/**
 * Update local db with data from Cloud
 * Simple logic: if Cloud is newer, sync entire provider
 * cloudProviders is object keyed by provider ID
 */
async function updateLocalTokens(cloudProviders) {
  const localProviders = await getProviderConnections();

  for (const localProvider of localProviders) {
    const cloudProvider = cloudProviders[localProvider.id];
    if (!cloudProvider) continue;

    const cloudUpdatedAt = new Date(cloudProvider.updatedAt || 0).getTime();
    const localUpdatedAt = new Date(localProvider.updatedAt || 0).getTime();

    // Simple logic: if Cloud is newer, sync entire provider
    if (cloudUpdatedAt > localUpdatedAt) {
      const updates = {
        // Tokens
        accessToken: cloudProvider.accessToken,
        refreshToken: cloudProvider.refreshToken,
        expiresAt: cloudProvider.expiresAt,
        expiresIn: cloudProvider.expiresIn,
        
        // Provider specific data
        providerSpecificData: cloudProvider.providerSpecificData || localProvider.providerSpecificData,
        
        // Status fields
        testStatus: cloudProvider.status || "active",
        lastError: cloudProvider.lastError,
        lastErrorAt: cloudProvider.lastErrorAt,
        errorCode: cloudProvider.errorCode,
        rateLimitedUntil: cloudProvider.rateLimitedUntil,
        
        // Metadata
        updatedAt: cloudProvider.updatedAt
      };

      await updateProviderConnection(localProvider.id, updates);
    }
  }
}
