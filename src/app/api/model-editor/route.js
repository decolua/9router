import { NextResponse } from "next/server";
import {
  getStudioModels,
  getStudioModel,
  setStudioModel,
  deleteStudioModel,
} from "@/lib/db/repos/modelEditorRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { normalizeTarget } from "@/lib/modelTargetNormalize.js";
import { getModelAliases } from "@/lib/db/repos/aliasRepo.js";
import { reconcileAllowedModels } from "@/lib/db/repos/apiKeysRepo.js";
import { findStudioCycle, describeStudioCycle } from "@/shared/utils/studioComboGuard.js";

export const dynamic = "force-dynamic";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}(\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})*$/;

/**
  * Target normalization lives in a shared helper so the bulk editor resolves
  * picks exactly like the create/edit form does.
  */

// GET /api/model-editor - list virtual (studio) models
export async function GET() {
  try {
  const models = await getStudioModels();
  return NextResponse.json({ models });
  } catch (error) {
  console.error("Error fetching virtual models:", error);
  return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

async function validate({ callName, targetModel, previousName }) {
  if (!NAME_RE.test(callName)) {
  return "Name must start with a letter or number and only use letters, numbers, dot, dash or underscore, with any number of prefix segments (max 64 per part).";
  }
  if (!targetModel || !targetModel.trim()) {
  return "Pick the model this name should call.";
  }
  const trimmed = targetModel.trim();
  const [models, combos, aliases] = await Promise.all([
  getStudioModels(),
  getCombos().catch(() => []),
  getModelAliases().catch(() => ({})),
  ]);
  if (callName !== previousName && models.some((m) => m.callName === callName)) {
  return `"${callName}" already exists - pick another name.`;
  }
  if (callName !== previousName && combos.some((c) => c.name === callName)) {
  return `"${callName}" is already used by a combo.`;
  }
  if (!trimmed.includes("/")) {
  // Bare names are combo targets only. A leftover studio chain still resolves
  // because normalizeTarget expanded chained names before validation; an
  // unknown bare name means the combo was renamed or deleted.
  if (!combos.some((c) => c.name === trimmed)) {
  return `"${trimmed}" is not a combo. Pick a combo or a provider model.`;
  }
  const cycle = findStudioCycle({
  callName,
  comboName: trimmed,
  combosByName: new Map(combos.map((c) => [c.name, c.models || []])),
  studioTargets: new Map(models.filter((m) => m.callName !== callName && m.callName !== previousName).map((m) => [m.callName, m.targetModel])),
  extraSelfNames: previousName && previousName !== callName ? [previousName] : [],
  });
  if (cycle) return describeStudioCycle(cycle);
  return null;
  }
  return null;
}

// POST /api/model-editor - create { callName, targetModel, displayName?, contextWindow?, systemPrompt? }
export async function POST(request) {
  try {
  const body = await request.json();
  const callName = String(body.callName || "").trim();
  const targetModel = await normalizeTarget(String(body.targetModel || "").trim());

  const error = await validate({ callName, targetModel });
  if (error) return NextResponse.json({ error }, { status: 400 });

  const model = await setStudioModel({
  callName,
  targetModel,
  targetLabel: body.targetModel,
  displayName: body.displayName,
  ownedBy: body.ownedBy,
  contextWindow: body.contextWindow,
  systemPrompt: body.systemPrompt,
  inputMultiplier: body.inputMultiplier,
  outputMultiplier: body.outputMultiplier,
  antiProbe: body.antiProbe,
  });

  return NextResponse.json({ model });
  } catch (error) {
  console.error("Error creating virtual model:", error);
  return NextResponse.json({ error: "Failed to create model" }, { status: 500 });
  }
}

// PUT /api/model-editor - update (body: { callName, previousName?, ...fields })
export async function PUT(request) {
  try {
  const body = await request.json();
  const previousName = String(body.previousName || body.callName || "").trim();
  const callName = String(body.callName || "").trim();
  const targetModel = await normalizeTarget(String(body.targetModel || "").trim());

  const existing = await getStudioModel(previousName);
  if (!existing) {
  return NextResponse.json({ error: `Model "${previousName}" not found.` }, { status: 404 });
  }

  const error = await validate({ callName, targetModel, previousName });
  if (error) return NextResponse.json({ error }, { status: 400 });

  const model = await setStudioModel({
  callName,
  targetModel,
  targetLabel: body.targetModel,
  displayName: body.displayName,
  ownedBy: body.ownedBy,
  contextWindow: body.contextWindow,
  systemPrompt: body.systemPrompt,
  inputMultiplier: body.inputMultiplier,
  outputMultiplier: body.outputMultiplier,
  antiProbe: body.antiProbe,
  });

  if (previousName !== callName) {
  await deleteStudioModel(previousName);
  // A key listing the old name should follow it to the new one rather than
  // silently pointing at a model that no longer exists.
  await reconcileAllowedModels({ renamed: { [previousName.toLowerCase()]: callName } });
  }

  return NextResponse.json({ model });
  } catch (error) {
  console.error("Error updating virtual model:", error);
  return NextResponse.json({ error: "Failed to update model" }, { status: 500 });
  }
}

// DELETE /api/model-editor?name=xxx
export async function DELETE(request) {
  try {
  const { searchParams } = new URL(request.url);
  const callName = String(searchParams.get("name") || "").trim();
  if (!callName) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const existing = await getStudioModel(callName);
  if (!existing) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  await deleteStudioModel(callName);
  const { emptied } = await reconcileAllowedModels({ removed: [callName] });

  return NextResponse.json({ success: true, ...(emptied.length ? { keysLeftForReview: emptied } : {}) });
  } catch (error) {
  console.error("Error deleting virtual model:", error);
  return NextResponse.json({ error: "Failed to delete model" }, { status: 500 });
  }
}
