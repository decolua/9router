"use server";

/**
 * POST /api/cli-tools/hermes-profiles/[id]/activate
 *
 * Activate a Hermes profile:
 *   1. Write its baseUrl + model to ~/.hermes/config.yaml.
 *   2. Sync its apiKey in ~/.hermes/.env, clearing any stale key when absent.
 *   3. Mark it as the active profile in the DB.
 *
 * Issue #1952 — Hermes multi-profile support.
 */

import { NextResponse } from "next/server";
import {
  getProfileById,
  listProfiles,
  sanitizeProfile,
  setActiveProfileId,
} from "@/lib/hermes/profileStore.js";
import {
  applyProfileToDisk,
  removeProfileFromDisk,
} from "@/lib/hermes/applyProfile.js";

async function restorePreviousDiskState(profile) {
  try {
    if (profile) await applyProfileToDisk(profile);
    else await removeProfileFromDisk();
  } catch (rollbackErr) {
    console.error("Failed to restore hermes profile on disk during rollback:", rollbackErr);
  }
}

export async function POST(_request, { params }) {
  const { id } = await params;
  try {
    const before = await listProfiles();
    const profile = before.profiles.find((candidate) => candidate.id === id)
      ?? await getProfileById(id);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const previousActiveProfile = before.profiles.find(
      (candidate) => candidate.id === before.activeProfileId
    ) ?? null;

    // Write settings to disk first so activeProfileId always matches the
    // current on-disk Hermes configuration.
    await applyProfileToDisk({
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
    });

    let activatedProfile;
    try {
      activatedProfile = await setActiveProfileId(id);
    } catch (storeErr) {
      await restorePreviousDiskState(previousActiveProfile);
      throw storeErr;
    }

    if (!activatedProfile) {
      await restorePreviousDiskState(previousActiveProfile);
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `Profile "${activatedProfile.name}" is now active`,
      profile: sanitizeProfile(activatedProfile),
    });
  } catch (err) {
    console.error("Error activating hermes profile:", err);
    return NextResponse.json(
      { error: "Failed to activate hermes profile" },
      { status: 500 }
    );
  }
}
