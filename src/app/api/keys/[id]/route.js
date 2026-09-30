import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, getApiKeys, updateApiKey } from "@/lib/localDb";
import { getSessionContext, DEFAULT_PERMISSIONS } from "@/lib/auth/dashboardPermissions";
import { parseAllowedModels, matchesAllowedModels } from "@/lib/db/repos/apiKeysRepo";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const ctx = await getSessionContext();

    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    if (ctx.session?.role === "apikey" && key.key !== ctx.session.apiKey) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const ctx = await getSessionContext();

    // API key user must have manageApiKeys to edit keys
    if (ctx.session?.role === "apikey" && !ctx.permissions.manageApiKeys) {
      return NextResponse.json({ error: "Permission denied: manageApiKeys" }, { status: 403 });
    }

    const body = await request.json();
    const { isActive } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // API key users cannot manage their own key
    if (ctx.session?.role === "apikey" && existing.key === ctx.session.apiKey) {
      return NextResponse.json({ error: "Cannot manage your own API key" }, { status: 403 });
    }

    // API key user can only edit their own key
    if (ctx.session?.role === "apikey" && existing.createdBy !== ctx.session.apiKey) {
      return NextResponse.json({ error: "Permission denied: cannot edit other keys" }, { status: 403 });
    }

    let trimmedName;
    if (body.name !== undefined) {
      trimmedName = typeof body.name === "string" ? body.name.trim() : "";
      if (!trimmedName) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      const existingKeys = await getApiKeys();
      if (existingKeys.some((k) => k.id !== id && k.name === trimmedName)) {
        return NextResponse.json({ error: `A key named "${trimmedName}" already exists. Use a different name.` }, { status: 409 });
      }
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (trimmedName !== undefined) updateData.name = trimmedName;
    if (body.usedTokens !== undefined) updateData.usedTokens = Number(body.usedTokens);
    if (body.lastResetAt !== undefined) updateData.lastResetAt = body.lastResetAt;
    if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;

    // Fields subject to scoping when edited by API key user
    if (body.tokenLimit !== undefined) {
      let limit = Number(body.tokenLimit);
      if (ctx.session?.role === "apikey") {
        const creatorLimit = ctx.session.tokenLimit || 0;
        if (creatorLimit > 0 && limit > creatorLimit) {
          return NextResponse.json({
            error: `Token limit cannot exceed your maximum (${creatorLimit}).`,
            creatorMax: creatorLimit,
          }, { status: 400 });
        }
      }
      updateData.tokenLimit = limit;
    }
    if (body.allowedModels !== undefined) {
      let allowed = body.allowedModels;
      if (ctx.session?.role === "apikey") {
        const creatorPatterns = parseAllowedModels(ctx.session.allowedModels);
        if (creatorPatterns) {
          const requestedList = (allowed || "*").split(",").map(m => m.trim().toLowerCase()).filter(Boolean);
          if (requestedList[0] !== "*") {
            const filtered = requestedList.filter(m => matchesAllowedModels(creatorPatterns, m));
            allowed = filtered.length ? filtered.join(",") : creatorPatterns.join(",");
          } else {
            // Wildcard or empty request is clamped to the creator's own scope.
            allowed = creatorPatterns.join(",");
          }
        }
      }
      updateData.allowedModels = allowed;
    }
    if (body.permissions !== undefined) {
      if (ctx.session?.role === "apikey") {
        // Same rule as creation: a key-authenticated session never edits permissions,
        // it can only land the sub-key on the default. Sending the field at all is
        // not an error, it just cannot move the value.
        updateData.permissions = DEFAULT_PERMISSIONS;
      } else {
        updateData.permissions = body.permissions;
      }
    }
    if (body.resetInterval !== undefined) updateData.resetInterval = body.resetInterval;
    if (body.rpmLimit !== undefined) updateData.rpmLimit = Number(body.rpmLimit);
    if (body.tpmLimit !== undefined) updateData.tpmLimit = Number(body.tpmLimit);
    if (body.ipWhitelist !== undefined) updateData.ipWhitelist = body.ipWhitelist;
    if (body.expiresAt !== undefined) updateData.expiresAt = body.expiresAt || null;

    const updated = await updateApiKey(id, updateData);
    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const ctx = await getSessionContext();

    if (ctx.session?.role === "apikey" && !ctx.permissions.manageApiKeys) {
      return NextResponse.json({ error: "Permission denied: manageApiKeys" }, { status: 403 });
    }

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // API key users cannot manage their own key
    if (ctx.session?.role === "apikey" && existing.key === ctx.session.apiKey) {
      return NextResponse.json({ error: "Cannot manage your own API key" }, { status: 403 });
    }

    // API key user can only delete their own key
    if (ctx.session?.role === "apikey" && existing.createdBy !== ctx.session.apiKey) {
      return NextResponse.json({ error: "Permission denied: cannot delete other keys" }, { status: 403 });
    }

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
