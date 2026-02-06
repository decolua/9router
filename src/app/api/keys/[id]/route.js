import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, isCloudEnabled, updateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";
import { normalizeAllowedModels } from "@/shared/services/apiKeyQuota";
import { generateApiKeyWithMachine } from "@/shared/utils/apiKey";
import crypto from "node:crypto";

// PATCH /api/keys/[id] - Update API key metadata and quota
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      ownerName,
      ownerEmail,
      ownerAge,
      requestLimit,
      tokenLimit,
      requestUsed,
      tokenUsed,
      allowedModels,
      isActive,
    } = body;

    if (requestLimit !== undefined) {
      const n = Number(requestLimit);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "requestLimit must be >= 0" }, { status: 400 });
      }
    }

    if (tokenLimit !== undefined) {
      const n = Number(tokenLimit);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "tokenLimit must be >= 0" }, { status: 400 });
      }
    }

    if (requestUsed !== undefined) {
      const n = Number(requestUsed);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "requestUsed must be >= 0" }, { status: 400 });
      }
    }

    if (tokenUsed !== undefined) {
      const n = Number(tokenUsed);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "tokenUsed must be >= 0" }, { status: 400 });
      }
    }

    if (ownerAge !== undefined && ownerAge !== null && ownerAge !== "") {
      const n = Number(ownerAge);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "ownerAge must be >= 0" }, { status: 400 });
      }
    }

    if (allowedModels !== undefined && !Array.isArray(allowedModels)) {
      return NextResponse.json({ error: "allowedModels must be an array" }, { status: 400 });
    }

    if (isActive !== undefined && typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
    }

    const updated = await updateApiKey(id, {
      name,
      ownerName,
      ownerEmail,
      ownerAge,
      requestLimit,
      tokenLimit,
      requestUsed,
      tokenUsed,
      allowedModels: allowedModels === undefined ? undefined : normalizeAllowedModels(allowedModels),
      isActive,
    });

    if (!updated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    await syncKeysToCloudIfEnabled();

    return NextResponse.json({
      ...updated,
      requestRemaining: updated.requestLimit > 0 ? Math.max(0, updated.requestLimit - (updated.requestUsed || 0)) : null,
      tokenRemaining: updated.tokenLimit > 0 ? Math.max(0, updated.tokenLimit - (updated.tokenUsed || 0)) : null,
    });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// POST /api/keys/[id] - Key actions (e.g. rotate key value)
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (body?.action === "rotate") {
      const graceHoursRaw = body?.graceHours;
      const graceHours = graceHoursRaw === undefined || graceHoursRaw === null
        ? 2
        : Number(graceHoursRaw);
      const allowedGraceHours = new Set([0, 1, 2, 24]);
      if (!Number.isInteger(graceHours) || !allowedGraceHours.has(graceHours)) {
        return NextResponse.json({ error: "graceHours must be one of 0, 1, 2, 24" }, { status: 400 });
      }

      const existing = await getApiKeyById(id);
      if (!existing) {
        return NextResponse.json({ error: "Key not found" }, { status: 404 });
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const previousKeys = Array.isArray(existing.previousKeys)
        ? existing.previousKeys
        : [];
      const activePreviousKeys = previousKeys.filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        if (!entry.keyHash) return false;
        const expiresAtMs = entry.expiresAt ? new Date(entry.expiresAt).getTime() : Number.NaN;
        return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
      });
      const filteredPreviousKeys = activePreviousKeys.filter((entry) => entry.keyHash !== hashApiKey(existing.key));
      const nextPreviousKeys = [...filteredPreviousKeys];

      if (graceHours > 0 && existing.key) {
        const expiresAt = new Date(nowMs + graceHours * 60 * 60 * 1000).toISOString();
        nextPreviousKeys.push({
          keyHash: hashApiKey(existing.key),
          rotatedAt: nowIso,
          expiresAt,
        });
      }

      const rotationHistory = Array.isArray(existing.rotationHistory)
        ? existing.rotationHistory
        : [];
      const rotationEntry = {
        rotatedAt: nowIso,
        graceHours,
      };
      if (graceHours > 0) {
        rotationEntry.expiresAt = new Date(nowMs + graceHours * 60 * 60 * 1000).toISOString();
      }

      // Always regenerate with server machineId to keep format consistent.
      const machineId = await getConsistentMachineId();
      const { key: newKey } = generateApiKeyWithMachine(machineId);

      const updated = await updateApiKey(id, {
        key: newKey,
        previousKeys: nextPreviousKeys,
        rotationHistory: [...rotationHistory, rotationEntry],
      });
      if (!updated) {
        return NextResponse.json({ error: "Key not found" }, { status: 404 });
      }

      await syncKeysToCloudIfEnabled();

      return NextResponse.json({
        id: updated.id,
        name: updated.name,
        key: updated.key,
        graceHours,
      });
    }

    if (body?.action === "revokePreviousKey") {
      const keyHash = String(body?.keyHash || "").trim();
      if (!keyHash) {
        return NextResponse.json({ error: "keyHash is required" }, { status: 400 });
      }

      const existing = await getApiKeyById(id);
      if (!existing) {
        return NextResponse.json({ error: "Key not found" }, { status: 404 });
      }

      const previousKeys = Array.isArray(existing.previousKeys)
        ? existing.previousKeys
        : [];
      const nextPreviousKeys = previousKeys.filter((entry) => entry?.keyHash !== keyHash);
      if (nextPreviousKeys.length === previousKeys.length) {
        return NextResponse.json({ error: "Previous key not found" }, { status: 404 });
      }

      const rotationHistory = Array.isArray(existing.rotationHistory)
        ? existing.rotationHistory
        : [];
      const updated = await updateApiKey(id, {
        previousKeys: nextPreviousKeys,
        rotationHistory: [
          ...rotationHistory,
          { rotatedAt: new Date().toISOString(), graceHours: 0, action: "revoke" },
        ],
      });
      if (!updated) {
        return NextResponse.json({ error: "Key not found" }, { status: 404 });
      }

      await syncKeysToCloudIfEnabled();

      return NextResponse.json({
        id: updated.id,
        name: updated.name,
        revoked: true,
      });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.log("Error rotating key:", error);
    return NextResponse.json({ error: "Failed to rotate key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // Auto sync to Cloud if enabled
    await syncKeysToCloudIfEnabled();

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}

/**
 * Sync API keys to Cloud if enabled
 */
async function syncKeysToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing keys to cloud:", error);
  }
}

function hashApiKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return crypto.createHash("sha256").update(raw).digest("hex");
}
