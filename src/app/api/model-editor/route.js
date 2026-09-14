import { NextResponse } from "next/server";
import {
  getStudioModels,
  getStudioModel,
  setStudioModel,
  deleteStudioModel,
} from "@/lib/db/repos/modelEditorRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { getModelAliases } from "@/lib/db/repos/aliasRepo.js";

export const dynamic = "force-dynamic";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
  * A picked model arrives as `prefix/model` where prefix is either a built-in
  * provider alias or a custom provider node prefix. Resolve the prefix to the
  * provider id the router actually uses so the alias resolves on its own.
  */
async function normalizeTarget(targetModel) {
 if (!targetModel.includes("/")) {
  // Chained pick: the name of another studio model resolves to its target.
  const chained = await getStudioModel(targetModel);
  if (chained) return chained.targetModel;
  return targetModel;
 }
 const firstSlash = targetModel.indexOf("/");
 if (firstSlash <= 0) return targetModel;
 const prefix = targetModel.slice(0, firstSlash);
 const rest = targetModel.slice(firstSlash + 1);
 try {
  const nodes = await getProviderNodes();
  const matched = nodes.find((node) => node.prefix === prefix || node.id === prefix);
  if (matched) return `${matched.id}/${rest}`;
 } catch { /* node lookup is best-effort */ }
 return `${resolveProviderAlias(prefix)}/${rest}`;
}

// GET /api/model-editor — list virtual (studio) models
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
  return "Name must start with a letter or number and only use letters, numbers, dot, dash or underscore (max 64, no \"/\").";
  }
  if (!targetModel || !targetModel.includes("/")) {
  return "Pick the model this name should call.";
  }
  const [models, combos, aliases] = await Promise.all([
  getStudioModels(),
  getCombos().catch(() => []),
  getModelAliases().catch(() => ({})),
  ]);
  if (callName !== previousName && models.some((m) => m.callName === callName)) {
  return `"${callName}" already exists — pick another name.`;
  }
  if (callName !== previousName && combos.some((c) => c.name === callName)) {
  return `"${callName}" is already used by a combo.`;
  }
  return null;
}

// POST /api/model-editor — create { callName, targetModel, displayName?, contextWindow?, systemPrompt? }
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
  contextWindow: body.contextWindow,
  systemPrompt: body.systemPrompt,
  });

  return NextResponse.json({ model });
  } catch (error) {
  console.error("Error creating virtual model:", error);
  return NextResponse.json({ error: "Failed to create model" }, { status: 500 });
  }
}

// PUT /api/model-editor — update (body: { callName, previousName?, ...fields })
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
  contextWindow: body.contextWindow,
  systemPrompt: body.systemPrompt,
  });

  if (previousName !== callName) {
  await deleteStudioModel(previousName);
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

  return NextResponse.json({ success: true });
  } catch (error) {
  console.error("Error deleting virtual model:", error);
  return NextResponse.json({ error: "Failed to delete model" }, { status: 500 });
  }
}
