"use server";

/**
 * GET  /api/cli-tools/hermes-profiles  — list all Hermes profiles.
 * POST /api/cli-tools/hermes-profiles  — create a new profile.
 *
 * Auto-migration: if the DB store is empty but ~/.hermes/config.yaml already
 * contains a 9Router model block, a "default" profile is created automatically
 * so existing single-profile users lose nothing (Issue #1952).
 */

import { NextResponse } from "next/server";
import {
  listProfiles,
  createProfile,
  validateProfileFields,
  migrateFromExistingConfig,
  looksLike9RouterConfig,
  sanitizeProfile,
} from "@/lib/hermes/profileStore.js";
import {
  parseModelBlock,
  readApiKeyFromEnv,
  readConfigYaml,
} from "@/lib/hermes/applyProfile.js";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    let store = await listProfiles();

    // Auto-migrate empty store from existing on-disk config
    if (store.profiles.length === 0) {
      const yaml = await readConfigYaml();
      const model = parseModelBlock(yaml);
      if (model?.default && looksLike9RouterConfig(model)) {
        const apiKey = await readApiKeyFromEnv();
        const migrated = await migrateFromExistingConfig(model, apiKey);
        if (migrated) store = migrated;
      }
    }

    const activeProfile =
      store.profiles.find((p) => p.id === store.activeProfileId) ?? null;

    return NextResponse.json({
      profiles: store.profiles.map(sanitizeProfile),
      activeProfileId: store.activeProfileId,
      activeProfile: sanitizeProfile(activeProfile),
    });
  } catch (err) {
    console.error("Error listing hermes profiles:", err);
    return NextResponse.json(
      { error: "Failed to list hermes profiles" },
      { status: 500 }
    );
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, baseUrl, model, apiKey } = body;

    const errors = validateProfileFields({ name, baseUrl, model });
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.join("; ") },
        { status: 400 }
      );
    }

    const profile = await createProfile({ name, baseUrl, model, apiKey });
    return NextResponse.json({ profile: sanitizeProfile(profile) }, { status: 201 });
  } catch (err) {
    console.error("Error creating hermes profile:", err);
    return NextResponse.json(
      { error: "Failed to create hermes profile" },
      { status: 500 }
    );
  }
}
