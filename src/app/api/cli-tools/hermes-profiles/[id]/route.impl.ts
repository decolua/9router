"use server";

/**
 * GET    /api/cli-tools/hermes-profiles/[id]  — get a single profile.
 * PUT    /api/cli-tools/hermes-profiles/[id]  — update a profile.
 * DELETE /api/cli-tools/hermes-profiles/[id]  — delete a profile.
 *
 * Issue #1952 — Hermes multi-profile support.
 */

import { NextRequest, NextResponse } from "next/server";
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

type HermesProfile = { id: string; name: string; baseUrl: string; model: string; apiKey: string | null; createdAt: string; updatedAt: string };
type ProfilePatch = { name?: string; baseUrl?: string; model?: string; apiKey?: string | null };

function validateProfilePatch({ name, baseUrl, model }: ProfilePatch) {
  const errors: string[] = [];
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

function normalizeBaseUrl(url: string) {
  return url.endsWith("/v1") ? url : `${url}/v1`;
}

function buildUpdatedProfile(profile: HermesProfile, updates: ProfilePatch) {
  const out = { ...profile };
  if (updates.name !== undefined) out.name = updates.name;
  if (updates.baseUrl !== undefined) out.baseUrl = normalizeBaseUrl(updates.baseUrl);
  if (updates.model !== undefined) out.model = updates.model;
  if (Object.prototype.hasOwnProperty.call(updates, "apiKey")) out.apiKey = updates.apiKey ?? null;
  return out;
}

async function restoreProfileOnDisk(profile: HermesProfile | null) {
  try {
    if (profile) await applyProfileToDisk({ baseUrl: profile.baseUrl, model: profile.model, apiKey: profile.apiKey });
    else await removeProfileFromDisk();
  } catch (rollbackErr) {
    console.error("Failed to restore hermes profile on disk during rollback:", rollbackErr);
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
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

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await request.json() as { name?: string; baseUrl?: string; model?: string; apiKey?: string };
    const { name, baseUrl, model, apiKey } = body;
    const errors = validateProfilePatch(Object.fromEntries(Object.entries({ name, baseUrl, model }).filter(([, v]) => v !== undefined)) as ProfilePatch);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
    }

    const partial: ProfilePatch = {};
    if (name !== undefined) partial.name = name;
    if (baseUrl !== undefined) partial.baseUrl = baseUrl;
    if (model !== undefined) partial.model = model;
    if (Object.prototype.hasOwnProperty.call(body, "apiKey")) {
      partial.apiKey = apiKey ?? null;
    }

    const before = await listProfiles();
    const existing = (before.profiles.find((profile) => profile.id === id) ?? null) as HermesProfile | null;
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const isActive = before.activeProfileId === id;
    const touchesDiskSettings =
      baseUrl !== undefined || model !== undefined || Object.prototype.hasOwnProperty.call(body, "apiKey");
    const pendingProfile = buildUpdatedProfile(existing, partial);

    if (isActive && touchesDiskSettings) {
      await applyProfileToDisk({ baseUrl: pendingProfile.baseUrl, model: pendingProfile.model, apiKey: pendingProfile.apiKey });
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

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const before = await listProfiles();
    const existing = (before.profiles.find((profile) => profile.id === id) ?? null) as HermesProfile | null;
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const wasActive = before.activeProfileId === id;
    const nextActive = (wasActive
      ? before.profiles.find((profile) => profile.id !== id) ?? null
      : null) as HermesProfile | null;

    if (wasActive) {
      if (nextActive) await applyProfileToDisk({ baseUrl: nextActive.baseUrl, model: nextActive.model, apiKey: nextActive.apiKey });
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
