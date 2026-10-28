import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "@/lib/db/driver.js";
import { stringifyJson } from "@/lib/db/helpers/jsonCol.js";
import { getSettings, updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
const VALID_KINDS = ["llm", "webSearch", "webFetch"];
const VALID_STRATEGIES = ["fallback", "round-robin", "fusion"];
const VALID_CAPACITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"];

// Validate and normalize a capacityAdapter object; returns { error } or { value }
function validateCapacityAdapter(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "capacityAdapter must be an object" };
  }
  const value = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!VALID_CAPACITY_KEYS.includes(key)) {
      return { error: `capacityAdapter: unknown capability "${key}"` };
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { error: `capacityAdapter.${key}: must be an object` };
    }
    if (entry.enabled != null && typeof entry.enabled !== "boolean") {
      return { error: `capacityAdapter.${key}: enabled must be a boolean` };
    }
    if (entry.roundRobin != null && typeof entry.roundRobin !== "boolean") {
      return { error: `capacityAdapter.${key}: roundRobin must be a boolean` };
    }
    if (entry.models != null && (!Array.isArray(entry.models) || entry.models.some((m) => typeof m !== "string"))) {
      return { error: `capacityAdapter.${key}: models must be an array of strings` };
    }
    value[key] = {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { value };
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Validate top-level structure
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON: expected an object with version and combos" }, { status: 400 });
    }

    if (!body.version || typeof body.version !== "number") {
      return NextResponse.json({ error: "Missing or invalid version field" }, { status: 400 });
    }

    if (!Array.isArray(body.combos)) {
      return NextResponse.json({ error: "Combos must be an array" }, { status: 400 });
    }

    if (body.combos.length === 0) {
      return NextResponse.json({ error: "At least one combo is required" }, { status: 400 });
    }

    // Validate optional capacityAdapter (vision/audio fallback pools)
    let importedCapacityAdapter = null;
    if (body.capacityAdapter != null) {
      const result = validateCapacityAdapter(body.capacityAdapter);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      importedCapacityAdapter = result.value;
    }

    // Validate each combo
    const nameSet = new Set();
    for (let i = 0; i < body.combos.length; i++) {
      const combo = body.combos[i];
      const idx = i + 1;

      if (!combo || typeof combo !== "object" || Array.isArray(combo)) {
        return NextResponse.json({ error: `Combo ${idx}: invalid entry` }, { status: 400 });
      }

      if (!combo.name || typeof combo.name !== "string" || !combo.name.trim()) {
        return NextResponse.json({ error: `Combo ${idx}: name is required` }, { status: 400 });
      }

      if (!VALID_NAME_REGEX.test(combo.name)) {
        return NextResponse.json({ error: `Combo ${idx}: name "${combo.name}" can only contain letters, numbers, -, _ and .` }, { status: 400 });
      }

      if (nameSet.has(combo.name)) {
        return NextResponse.json({ error: `Combo ${idx}: duplicate name "${combo.name}"` }, { status: 400 });
      }
      nameSet.add(combo.name);

      if (combo.kind != null && !VALID_KINDS.includes(combo.kind)) {
        return NextResponse.json({ error: `Combo ${idx}: invalid kind "${combo.kind}"` }, { status: 400 });
      }

      if (!Array.isArray(combo.models)) {
        return NextResponse.json({ error: `Combo ${idx}: models must be an array` }, { status: 400 });
      }

      if (combo.roundRobin != null && typeof combo.roundRobin !== "boolean") {
        return NextResponse.json({ error: `Combo ${idx}: roundRobin must be a boolean` }, { status: 400 });
      }

      if (combo.strategy != null) {
        if (typeof combo.strategy !== "object" || Array.isArray(combo.strategy)) {
          return NextResponse.json({ error: `Combo ${idx}: strategy must be an object` }, { status: 400 });
        }
        if (combo.strategy.fallbackStrategy && !VALID_STRATEGIES.includes(combo.strategy.fallbackStrategy)) {
          return NextResponse.json({ error: `Combo ${idx}: invalid strategy "${combo.strategy.fallbackStrategy}"` }, { status: 400 });
        }
        if (combo.strategy.judgeModel != null && typeof combo.strategy.judgeModel !== "string") {
          return NextResponse.json({ error: `Combo ${idx}: judgeModel must be a string` }, { status: 400 });
        }
      }
    }

    // Execute import in a single transaction
    const db = await getAdapter();
    const now = new Date().toISOString();

    db.transaction(() => {
      // Delete all existing combos
      db.run(`DELETE FROM combos`);

      // Insert each combo with new UUID and current timestamp
      for (const combo of body.combos) {
        db.run(
          `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            combo.name.trim(),
            combo.kind || null,
            stringifyJson(combo.models || []),
            now,
            now,
          ]
        );
      }
    });

    // Persist combo strategies in settings
    const settings = await getSettings();
    const currentStrategies = settings?.comboStrategies || {};
    const updatedStrategies = { ...currentStrategies };

    for (const combo of body.combos) {
      const name = combo.name.trim();

      // New format (v2): explicit strategy object
      if (combo.strategy) {
        const strategy = { fallbackStrategy: combo.strategy.fallbackStrategy || "fallback" };
        if (combo.strategy.judgeModel) strategy.judgeModel = combo.strategy.judgeModel;
        updatedStrategies[name] = strategy;
        continue;
      }

      // Legacy format (v1): roundRobin boolean
      if (combo.roundRobin === true) {
        updatedStrategies[name] = { fallbackStrategy: "round-robin" };
      } else {
        delete updatedStrategies[name];
      }
    }

    const settingsPatch = { comboStrategies: updatedStrategies };

    // Merge imported capacity adapter over existing entries (only keys present in file)
    if (importedCapacityAdapter) {
      const currentAdapter = settings?.capacityAdapter || {};
      settingsPatch.capacityAdapter = { ...currentAdapter, ...importedCapacityAdapter };
    }

    await updateSettings(settingsPatch);

    return NextResponse.json({ success: true, count: body.combos.length }, { status: 201 });
  } catch (error) {
    console.log("Error importing combos:", error);
    return NextResponse.json({ error: "Failed to import combos" }, { status: 500 });
  }
}
