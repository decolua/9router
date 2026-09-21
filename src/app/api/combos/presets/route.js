import { NextResponse } from "next/server";
import { getCombos, createCombo, getProviderConnections } from "@/lib/localDb";
import { buildPresetItems, PRESET_SOURCES } from "@/lib/comboPresets";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";

export const dynamic = "force-dynamic";

/**
 * Resolve live Cursor catalog from the first active cursor connection, if any.
 * @returns {Promise<Array<{id: string, name?: string}>|null>}
 */
async function fetchCursorLiveModels() {
  try {
    const connections = await getProviderConnections();
    const conn = (connections || []).find(
      (c) => c.provider === "cursor" && c.isActive !== false
    );
    if (!conn) return null;
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    }, { log: console });
    return result?.models?.length ? result.models : null;
  } catch (error) {
    console.log("combo presets: cursor live catalog failed", error?.message || error);
    return null;
  }
}

/**
 * @param {string} source
 * @returns {Promise<{ name: string, models: string[], exists: boolean }[]>}
 */
async function resolvePresetItems(source) {
  const combos = await getCombos();
  const existingNames = (combos || []).map((c) => c.name);
  const liveModels = source === "cursor" ? await fetchCursorLiveModels() : null;
  return buildPresetItems(source, {
    liveModels: liveModels || undefined,
    existingNames,
  });
}

function parseSource(value) {
  if (!value || !PRESET_SOURCES.has(value)) return null;
  return value;
}

// GET /api/combos/presets?source=cursor|claude — preview items
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = parseSource(searchParams.get("source"));
    if (!source) {
      return NextResponse.json(
        { error: "source must be 'cursor' or 'claude'" },
        { status: 400 }
      );
    }

    const items = await resolvePresetItems(source);
    return NextResponse.json({
      source,
      items,
      toCreate: items.filter((i) => !i.exists).length,
      toSkip: items.filter((i) => i.exists).length,
    });
  } catch (error) {
    console.log("Error previewing combo presets:", error);
    return NextResponse.json({ error: "Failed to preview combo presets" }, { status: 500 });
  }
}

// POST /api/combos/presets — create missing combos for a source
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const source = parseSource(body?.source);
    if (!source) {
      return NextResponse.json(
        { error: "source must be 'cursor' or 'claude'" },
        { status: 400 }
      );
    }

    const items = await resolvePresetItems(source);
    const created = [];
    const skipped = [];

    for (const item of items) {
      if (item.exists) {
        skipped.push(item.name);
        continue;
      }
      const combo = await createCombo({ name: item.name, models: item.models });
      created.push(combo);
    }

    return NextResponse.json({
      source,
      created,
      skipped,
      createdCount: created.length,
      skippedCount: skipped.length,
    });
  } catch (error) {
    console.log("Error creating combo presets:", error);
    return NextResponse.json({ error: "Failed to create combo presets" }, { status: 500 });
  }
}
