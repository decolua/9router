"use server";

/**
 * GET    /api/cli-tools/hermes-profiles/[id]  — get a single profile.
 * PUT    /api/cli-tools/hermes-profiles/[id]  — update a profile.
 * DELETE /api/cli-tools/hermes-profiles/[id]  — delete a profile.
 *
 * Issue #1952 — Hermes multi-profile support.
 */

import { NextResponse } from "next/server";
import {
  deleteProfile,
  getProfileById,
  listProfiles,
  sanitizeProfile,
  updateProfile,
} from "@/lib/hermes/profileStore.js";
import {
  applyProfileToDisk,
  removeProfileFromDisk,
} from "@/lib/hermes/applyProfile.js";

function validateProfilePatch({ name, baseUrl, model }) {
  const errors = [];
  if (name !== undefined && (!name || typeof name !== "string" || !name.trim())) {
    errors.push("name is required");
  }
  if (baseUrl !== undefined && (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim())) {
    errors.push("baseUrl is required");
  }
  if (model !== undefined && (!model || typeof model !== "string" || !model.trim())) {
    errors.push("model is required");
  }
  return errors;
}

function normalizeBaseUrl(url) {
  if (!url) return url;
  const trimmed = String(url).trim();
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function buildUpdatedProfile(profile, updates) {
  const merged = { ...profile };
  if (updates.name !== undefined) merged.name = String(updates.name).trim();
  if (updates.baseUrl !== undefined) merged.baseUrl = normalizeBaseUrl(updates.baseUrl);
  if (updates.model !== undefined) merged.model = String(updates.model).trim();
  if (Object.prototype.hasOwnProperty.call(updates, "apiKey")) {
    merged.apiKey = updates.apiKey || null;
  }
  return merged;
}

async function restoreProfileOnDisk(profile) {
  if (!profile) return;
  try {
    await applyProfileToDisk(profile);
  } catch (rollbackErr) {
    console.error("Failed to restore hermes profile on disk during rollback:", rollbackErr);
  }
}

export async function GET(_request, { params }) {
  const { id } = await params;
  try {
    const profile = await getProfileById(id);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ profile: sanitizeProfile(profile) });
  } catch (err) {
    console.error("Error getting hermes profile:", err);
    return NextResponse.json(
      { error: "Failed to get hermes profile" },
      { status: 500 }
    );
  }
}

export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, baseUrl, model, apiKey } = body;
    const errors = validateProfilePatch({ name, baseUrl, model });
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
    }

    const partial = {};
    if (name !== undefined) partial.name = name;
    if (baseUrl !== undefined) partial.baseUrl = baseUrl;
    if (model !== undefined) partial.model = model;
    if (Object.prototype.hasOwnProperty.call(body, "apiKey")) {
      partial.apiKey = apiKey;
    }

    const before = await listProfiles();
    const existing = before.profiles.find((profile) => profile.id === id) ?? null;
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const isActive = before.activeProfileId === id;
    const touchesDiskSettings =
      baseUrl !== undefined || model !== undefined || Object.prototype.hasOwnProperty.call(body, "apiKey");
    const pendingProfile = buildUpdatedProfile(existing, partial);

    if (isActive && touchesDiskSettings) {
      await applyProfileToDisk(pendingProfile);
    }

    let updated;
    try {
      updated = await updateProfile(id, partial);
    } catch (updateErr) {
      if (isActive && touchesDiskSettings) await restoreProfileOnDisk(existing);
      throw updateErr;
    }

    if (!updated) {
      if (isActive && touchesDiskSettings) await restoreProfileOnDisk(existing);
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json({ profile: sanitizeProfile(updated) });
  } catch (err) {
    console.error("Error updating hermes profile:", err);
    return NextResponse.json(
      { error: "Failed to update hermes profile" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  try {
    const before = await listProfiles();
    const existing = before.profiles.find((profile) => profile.id === id) ?? null;
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const wasActive = before.activeProfileId === id;
    const nextActive = wasActive
      ? before.profiles.find((profile) => profile.id !== id) ?? null
      : null;

    if (wasActive) {
      if (nextActive) await applyProfileToDisk(nextActive);
      else await removeProfileFromDisk();
    }

    let deleted;
    try {
      deleted = await deleteProfile(id);
    } catch (deleteErr) {
      if (wasActive) await restoreProfileOnDisk(existing);
      throw deleteErr;
    }

    if (!deleted) {
      if (wasActive) await restoreProfileOnDisk(existing);
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting hermes profile:", err);
    return NextResponse.json(
      { error: "Failed to delete hermes profile" },
      { status: 500 }
    );
  }
}
