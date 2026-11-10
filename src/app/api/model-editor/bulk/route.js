import { NextResponse } from "next/server";
import { getStudioModel, getStudioModels, setStudioModel } from "@/lib/db/repos/modelEditorRepo.js";
import { findStudioCycle } from "@/shared/utils/studioComboGuard.js";
import { normalizeTarget } from "@/lib/modelTargetNormalize.js";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/model-editor/bulk - { names: [...], patch: { ... } }
 *
 * Editing twenty virtual models one at a time is how a multiplier ends up
 * half-applied, so the same field is written to every selected model in one
 * call. Only the fields that make sense in bulk are accepted: the callable name
 * IS the model id clients send, so it is never renamed by a bulk action, while
 * the upstream target may be re-pointed for the whole selection at once.
 */
const BULK_FIELDS = new Set(["inputMultiplier", "outputMultiplier", "contextWindow", "targetModel"]);

function normalizePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { error: "No changes given" };
  }
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!BULK_FIELDS.has(key)) return { error: `Field "${key}" cannot be changed in bulk` };
    if (key === "targetModel") {
      const target = String(value ?? "").trim();
      if (!target) return { error: "Target model cannot be empty" };
      if (target.length > 200) return { error: "Target model is too long" };
      clean.targetModel = target;
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return { error: `${key} must be a number of 0 or more` };
    clean[key] = n;
  }
  if (!Object.keys(clean).length) return { error: "No changes given" };
  return { patch: clean };
}

export async function PATCH(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const names = Array.isArray(body?.names)
    ? body.names.map(String).map((n) => n.trim()).filter(Boolean)
    : [];
  if (!names.length) return NextResponse.json({ error: "No models selected" }, { status: 400 });
  if (names.length > 200) {
    return NextResponse.json({ error: "Select at most 200 models at once" }, { status: 400 });
  }

  const parsed = normalizePatch(body?.patch);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  let studioTargets = null;
  if (parsed.patch.targetModel !== undefined) {
    parsed.patch.targetModel = await normalizeTarget(parsed.patch.targetModel);
    const all = await getStudioModels();
    studioTargets = new Map(all.map((m) => [m.callName, m.targetModel]));
    for (const name of names) {
      const chain = findStudioCycle({
        callName: name,
        comboName: parsed.patch.targetModel,
        combosByName: new Map(),
        studioTargets,
      });
      if (chain) {
        return NextResponse.json(
          { error: `Routing ${name} to ${parsed.patch.targetModel} would loop: ${chain.join(" -> ")}` },
          { status: 400 },
        );
      }
    }
  }

  const updated = [];
  const missing = [];

  for (const name of names) {
    try {
      const existing = await getStudioModel(name);
      if (!existing) {
        missing.push(name);
        continue;
      }
      // setStudioModel writes a whole record, so the untouched fields travel
      // back in exactly as they were read - a bulk edit is not a re-pointing.
      // A multiplier set to 0 removes it, which is what the create form does
      // with an empty field too.
      const pick = (key, fallback) =>
        parsed.patch[key] !== undefined ? Number(parsed.patch[key]) : fallback;

      await setStudioModel({
        callName: existing.callName,
        displayName: existing.displayName,
        ownedBy: existing.ownedBy,
        targetModel: parsed.patch.targetModel !== undefined ? parsed.patch.targetModel : existing.targetModel,
        // A re-pointed model shows the new target; leaving it alone keeps the
        // label the operator originally picked.
        targetLabel: parsed.patch.targetModel !== undefined ? parsed.patch.targetModel : existing.targetLabel,
        contextWindow: pick("contextWindow", Number(existing.contextWindow) || 0),
        systemPrompt: existing.systemPrompt,
        inputMultiplier: pick("inputMultiplier", existing.inputMultiplier),
        outputMultiplier: pick("outputMultiplier", existing.outputMultiplier),
        antiProbe: existing.antiProbe,
      });
      updated.push(name);
    } catch {
      missing.push(name);
    }
  }

  return NextResponse.json({ updated, missing, applied: parsed.patch });
}
