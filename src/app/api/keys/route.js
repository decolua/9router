import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getSessionContext, DEFAULT_PERMISSIONS } from "@/lib/auth/dashboardPermissions";
import { creatorNameFor, DASHBOARD_CREATOR, visibleApiKeys } from "@/lib/auth/keyCreator";
import { parseAllowedModels, matchesAllowedModels } from "@/lib/db/repos/apiKeysRepo";
import { recordSecurityEvent } from "@/lib/db/repos/securityLogRepo";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const ctx = await getSessionContext();
    const allKeys = await getApiKeys();
    // One helper answers visibility for every page, so the endpoint list and the
    // per-key usage list show a creator session the same keys. Raw creator keys
    // would hand a session another key's secret, so they never leave this API:
    // the payload carries the creator's name instead.
    const keys = visibleApiKeys(allKeys, ctx.session).map((k) => ({
      ...k,
      createdBy: k.createdBy === DASHBOARD_CREATOR ? DASHBOARD_CREATOR : "",
      createdByName: creatorNameFor({ createdBy: k.createdBy, keys: allKeys }),
    }));
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const ctx = await getSessionContext();

    // API key user must have manageApiKeys to create sub-keys
    if (ctx.session?.role === "apikey" && !ctx.permissions.manageApiKeys) {
      return NextResponse.json({ error: "Permission denied: manageApiKeys" }, { status: 403 });
    }

    const body = await request.json();
    let {
      name, tokenLimit, resetInterval, allowedModels,
      rpmLimit, tpmLimit, dailyCostLimit, requestLimit, limitKind, expiresAt, systemPrompt,
      permissions: requestedPermissions,
    } = body;

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Enforce unique key names
    const existingKeys = await getApiKeys();
    if (existingKeys.some((k) => k.name === trimmedName)) {
      return NextResponse.json({ error: `A key named "${trimmedName}" already exists. Use a different name.` }, { status: 409 });
    }

    // Scoping: a session authenticated by an API key cannot hand out permissions at
    // all. Whatever it asks for, the sub-key is created with the default (view usage
    // only), so a key that can create keys cannot mint one with more reach than it
    // was given. The dashboard renders the same rule as a disabled editor.
    let finalPermissions = requestedPermissions;
    if (ctx.session?.role === "apikey") {
      finalPermissions = DEFAULT_PERMISSIONS;

      // Token limit: sub-key cannot exceed creator's limit
      const creatorLimit = ctx.session.tokenLimit || 0;
      const requestedLimit = Number(tokenLimit) || 0;
      if (creatorLimit > 0 && requestedLimit > creatorLimit) {
        return NextResponse.json({
          error: `Token limit cannot exceed your maximum (${creatorLimit}).`,
          creatorMax: creatorLimit,
        }, { status: 400 });
      }

      // Cost cap follows the same rule as the token cap: a sub-key may only be
      // cheaper than its creator, otherwise minting keys would be a way to spend
      // past the budget the creator was given.
      const creatorCostLimit = Number(ctx.session.dailyCostLimit) || 0;
      const requestedCostLimit = Number(dailyCostLimit) || 0;
      if (creatorCostLimit > 0 && requestedCostLimit > creatorCostLimit) {
        return NextResponse.json({
          error: `Daily cost limit cannot exceed your maximum ($${creatorCostLimit}).`,
          creatorMax: creatorCostLimit,
        }, { status: 400 });
      }

      // Allowed models: sub-key can only use a subset of creator's models.
      // Match against both the bare model id and the provider-qualified value,
      // so a custom model entered by its bare id is not silently dropped.
      const creatorPatterns = parseAllowedModels(ctx.session.allowedModels);
      if (creatorPatterns) {
        const requestedList = (allowedModels || "*").split(",").map(m => m.trim().toLowerCase()).filter(Boolean);
        if (requestedList[0] !== "*") {
          const filtered = requestedList.filter((model) =>
            matchesAllowedModels(creatorPatterns, model) ||
            matchesAllowedModels(creatorPatterns, `${model}/*`)
          );
          allowedModels = filtered.length ? filtered.join(",") : creatorPatterns.join(",");
        } else {
          // Wildcard or empty request is clamped to the creator's own scope.
          allowedModels = creatorPatterns.join(",");
        }
        // If creator is wildcard ("*"), sub-key can use "*"
      }
    }

    const machineId = await getConsistentMachineId();
    const createdBy = ctx.session?.role === "apikey" ? ctx.session.apiKey : "dashboard";
    const prefix = typeof body?.prefix === "string" ? body.prefix.trim() : null;
    const apiKey = await createApiKey(trimmedName, machineId, {
      prefix,
      tokenLimit: tokenLimit !== undefined ? Number(tokenLimit) : 0,
      resetInterval: resetInterval || "never",
      allowedModels: allowedModels || "*",
      rpmLimit: rpmLimit !== undefined ? Number(rpmLimit) : 0,
      tpmLimit: tpmLimit !== undefined ? Number(tpmLimit) : 0,
      dailyCostLimit: dailyCostLimit !== undefined ? Number(dailyCostLimit) : 0,
      requestLimit: requestLimit !== undefined ? Number(requestLimit) : 0,
      limitKind: limitKind === "cost" || limitKind === "requests" ? limitKind : "tokens",
      expiresAt: expiresAt || null,
      systemPrompt: systemPrompt || "",
      permissions: finalPermissions,
      createdBy,
    });
    if (prefix) {
      try {
        const { updateSettings } = await import("@/lib/localDb");
        await updateSettings({ apiKeyPrefix: prefix });
      } catch {}
    }

    // A credential appearing: record who minted it and exactly what it may do.
    try {
      await recordSecurityEvent({
        type: "key_created",
        severity: "info",
        actor:
          ctx.session?.role === "apikey"
            ? `API key "${ctx.session.keyName || ctx.session.keyId}"`
            : "Password user",
        method: "POST",
        path: "/api/keys",
        detail: `Created API key "${trimmedName}" - permissions: ${JSON.stringify(finalPermissions || {})}`,
      });
    } catch {
      // Auditing is best effort.
    }

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      isActive: apiKey.isActive,
      tokenLimit: apiKey.tokenLimit,
      usedTokens: apiKey.usedTokens,
      resetInterval: apiKey.resetInterval,
      lastResetAt: apiKey.lastResetAt,
      allowedModels: apiKey.allowedModels,
      rpmLimit: apiKey.rpmLimit,
      tpmLimit: apiKey.tpmLimit,
      dailyCostLimit: apiKey.dailyCostLimit,
      requestLimit: apiKey.requestLimit,
      limitKind: apiKey.limitKind,
      permissions: apiKey.permissions,
      // The raw creator key is a secret and never leaves the server; the client
      // only ever needs to label who made this one.
      createdBy: "",
      createdByName: creatorNameFor({ createdBy: apiKey.createdBy, keys: await getApiKeys() }),
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}