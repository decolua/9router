import { NextResponse } from "next/server";
import {
  deleteModelDisplayName,
  getModelDisplayNames,
  setModelDisplayName,
} from "@/models";
import { getOriginModelIds } from "@/shared/utils/modelDisplayNames";

export const dynamic = "force-dynamic";

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function findDisplayConflict(displayNames, originModelId, displayModelId) {
  const displayConflict = Object.entries(displayNames).find(
    ([origin, display]) =>
      origin !== originModelId && display === displayModelId,
  );
  if (displayConflict) return displayConflict;

  if (
    displayModelId !== originModelId &&
    Object.prototype.hasOwnProperty.call(displayNames, displayModelId)
  ) {
    return [displayModelId, displayNames[displayModelId]];
  }

  return null;
}

async function findOriginModelConflict(originModelId, displayModelId) {
  const { buildModelsList } = await import("@/app/api/v1/models/route.js");
  const models = await buildModelsList(["llm"], { applyDisplayNames: false });
  const originModelIds = getOriginModelIds(models);
  return displayModelId !== originModelId && originModelIds.has(displayModelId)
    ? displayModelId
    : null;
}

export async function GET() {
  try {
    const displayNames = await getModelDisplayNames();
    return NextResponse.json({ displayNames });
  } catch (error) {
    console.log("Error fetching model display names:", error);
    return NextResponse.json(
      { error: "Failed to fetch display names" },
      { status: 500 },
    );
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const originModelId = normalizeValue(body.originModelId);
    const displayModelId = normalizeValue(body.displayModelId);

    if (!originModelId || !displayModelId) {
      return NextResponse.json(
        { error: "Origin model ID and display model ID required" },
        { status: 400 },
      );
    }

    if (displayModelId === originModelId) {
      await deleteModelDisplayName(originModelId);
      return NextResponse.json({
        success: true,
        originModelId,
        displayModelId: originModelId,
        reset: true,
      });
    }

    const displayNames = await getModelDisplayNames();
    const conflict = findDisplayConflict(
      displayNames,
      originModelId,
      displayModelId,
    );
    if (conflict) {
      return NextResponse.json(
        { error: `Display model ID already in use for ${conflict[0]}` },
        { status: 400 },
      );
    }

    const originConflict = await findOriginModelConflict(
      originModelId,
      displayModelId,
    );
    if (originConflict) {
      return NextResponse.json(
        {
          error: `Display model ID conflicts with existing model '${originConflict}'`,
        },
        { status: 400 },
      );
    }

    await setModelDisplayName(originModelId, displayModelId);
    return NextResponse.json({ success: true, originModelId, displayModelId });
  } catch (error) {
    console.log("Error updating model display name:", error);
    return NextResponse.json(
      { error: "Failed to update display name" },
      { status: 500 },
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const originModelId = normalizeValue(searchParams.get("originModelId"));

    if (!originModelId) {
      return NextResponse.json(
        { error: "Origin model ID required" },
        { status: 400 },
      );
    }

    await deleteModelDisplayName(originModelId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting model display name:", error);
    return NextResponse.json(
      { error: "Failed to delete display name" },
      { status: 500 },
    );
  }
}
