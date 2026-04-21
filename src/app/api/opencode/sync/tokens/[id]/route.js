import { NextResponse } from "next/server";

import { listOpenCodeTokens, replaceOpenCodeTokens } from "@/models";
import { normalizeSyncTokenPatch, toPublicTokenRecord } from "@/lib/opencodeSync/tokens.js";

async function getTokenId(context) {
  const params = await Promise.resolve(context?.params);
  return typeof params?.id === "string" ? params.id.trim() : "";
}

function isValidationError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return /^Invalid\b/u.test(message) || /required/u.test(message) || /cannot be updated/u.test(message);
}

export async function PATCH(request, context) {
  try {
    const id = await getTokenId(context);
    if (!id) {
      return NextResponse.json({ error: "Token id is required" }, { status: 400 });
    }

    const payload = await request.json();
    const updates = normalizeSyncTokenPatch(payload);
    const tokens = await listOpenCodeTokens();
    const currentTokens = tokens || [];
    const index = currentTokens.findIndex((record) => record?.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }

    const nextRecord = {
      ...currentTokens[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const nextTokens = [...currentTokens];
    nextTokens[index] = nextRecord;
    await replaceOpenCodeTokens(nextTokens);

    return NextResponse.json({ record: toPublicTokenRecord(nextRecord) });
  } catch (error) {
    if (error instanceof SyntaxError || isValidationError(error)) {
      return NextResponse.json({ error: error?.message || "Invalid token payload" }, { status: 400 });
    }

    console.log("Error updating OpenCode sync token:", error);
    return NextResponse.json({ error: "Failed to update OpenCode sync token" }, { status: 500 });
  }
}

export async function DELETE(_request, context) {
  try {
    const id = await getTokenId(context);
    if (!id) {
      return NextResponse.json({ error: "Token id is required" }, { status: 400 });
    }

    const tokens = await listOpenCodeTokens();
    const nextTokens = (tokens || []).filter((record) => record?.id !== id);

    if (nextTokens.length === (tokens || []).length) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }

    await replaceOpenCodeTokens(nextTokens);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting OpenCode sync token:", error);
    return NextResponse.json({ error: "Failed to delete OpenCode sync token" }, { status: 500 });
  }
}
