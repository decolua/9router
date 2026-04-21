import { NextResponse } from "next/server";

import { mutateOpenCodeTokens } from "@/models";
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
    let nextRecord = null;
    let found = false;

    await mutateOpenCodeTokens((currentTokens) => {
      const index = currentTokens.findIndex((record) => record?.id === id);
      if (index === -1) {
        return { tokens: currentTokens };
      }

      found = true;
      nextRecord = {
        ...currentTokens[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      const nextTokens = [...currentTokens];
      nextTokens[index] = nextRecord;
      return { tokens: nextTokens };
    });

    if (!found || !nextRecord) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }

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

    let removed = false;
    await mutateOpenCodeTokens((tokens) => {
      const nextTokens = tokens.filter((record) => record?.id !== id);
      removed = nextTokens.length !== tokens.length;
      return { tokens: nextTokens };
    });

    if (!removed) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting OpenCode sync token:", error);
    return NextResponse.json({ error: "Failed to delete OpenCode sync token" }, { status: 500 });
  }
}
