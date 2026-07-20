import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

const CF_API = "https://api.cloudflare.com/client/v4";

function cfHeaders(globalApiKey, email) {
  return {
    "X-Auth-Key": globalApiKey,
    "X-Auth-Email": email,
    "Content-Type": "application/json",
  };
}

async function cfFetch(path, globalApiKey, email, options = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      ...cfHeaders(globalApiKey, email),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!data.success) {
    const msg = data.errors?.[0]?.message || "Cloudflare API error";
    throw new Error(msg);
  }
  return data.result;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { globalApiKey, email, tokenName } = body || {};

    if (!globalApiKey || !email) {
      return NextResponse.json({ error: "globalApiKey and email are required" }, { status: 400 });
    }

    const cleanGAK = String(globalApiKey).trim();
    const cleanEmail = String(email).trim();
    if (!cleanGAK || cleanGAK.length < 32) {
      return NextResponse.json({ error: "Invalid Global API Key format. Must be your Cloudflare Global API Key (37 hex chars), not a scoped token." }, { status: 400 });
    }
    if (!cleanEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // 1. List accounts → take first
    const accounts = await cfFetch("/accounts?per_page=1", cleanGAK, cleanEmail);
    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ error: "No Cloudflare accounts found for this credential" }, { status: 400 });
    }
    const account = accounts[0];
    const accountId = account.id;
    const accountName = account.name;

    // 2. Get permission groups → find Workers AI Read + Edit
    const permGroups = await cfFetch(
      `/accounts/${accountId}/tokens/permission_groups`,
      cleanGAK,
      cleanEmail
    );

    const readGroup = permGroups.find(
      (g) => g.name === "Workers AI Read" || g.name === "Workers AI:Read"
    );
    const editGroup = permGroups.find(
      (g) => g.name === "Workers AI Edit" || g.name === "Workers AI:Edit"
    );
    const analyticsReadGroup = permGroups.find(
      (g) => g.name === "Account Analytics Read" || g.name === "Account Analytics:Read"
        || (g.name.toLowerCase().includes("account analytics") && g.name.toLowerCase().includes("read"))
    );

    const waFallbackRead = permGroups.find((g) =>
      g.name.toLowerCase().includes("workers ai") &&
      g.name.toLowerCase().includes("read") &&
      !g.name.toLowerCase().includes("metadata")
    );
    const waFallbackWrite = permGroups.find((g) =>
      g.name.toLowerCase().includes("workers ai") &&
      (g.name.toLowerCase().includes("write") || g.name.toLowerCase().includes("edit")) &&
      !g.name.toLowerCase().includes("metadata")
    );

    if (!readGroup && !waFallbackRead) {
      return NextResponse.json({
        error: `Workers AI permission groups not found. Available: ${permGroups.map(g => g.name).join(", ")}`,
      }, { status: 400 });
    }

    const finalReadGroup = readGroup || waFallbackRead;
    const finalEditGroup = editGroup || waFallbackWrite || finalReadGroup;

    const permissionGroups = [
      { id: finalReadGroup.id },
      { id: finalEditGroup.id },
    ];
    if (analyticsReadGroup) permissionGroups.push({ id: analyticsReadGroup.id });

    const tokenPayload = {
      name: tokenName || "9router Workers AI",
      policies: [
        {
          effect: "allow",
          permission_groups: permissionGroups,
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
        },
      ],
    };

    const tokenResult = await cfFetch("/user/tokens", cleanGAK, cleanEmail, {
      method: "POST",
      body: JSON.stringify(tokenPayload),
    });

    const newApiToken = tokenResult.value;
    const tokenId = tokenResult.id;

    // 4. Upsert cloudflare-ai provider connection
    const existing = await getProviderConnections({ provider: "cloudflare-ai" });

    let savedConnection;
    if (existing.length > 0) {
      savedConnection = await updateProviderConnection(existing[0].id, {
        apiKey: newApiToken,
        providerSpecificData: {
          ...(existing[0].providerSpecificData || {}),
          accountId,
        },
        name: existing[0].name || `Cloudflare (${accountName})`,
      });
    } else {
      savedConnection = await createProviderConnection({
        provider: "cloudflare-ai",
        authType: "apikey",
        name: `Cloudflare (${accountName})`,
        apiKey: newApiToken,
        email: "",
        priority: 1,
        globalPriority: null,
        defaultModel: null,
        providerSpecificData: { accountId },
        isActive: true,
        testStatus: "unknown",
      });
    }

    return NextResponse.json({
      ok: true,
      accountId,
      accountName,
      tokenId,
      connectionId: savedConnection?.id,
      message: `✅ Token created and saved! Account: ${accountName} (${accountId})`,
    });
  } catch (err) {
    console.error("[cloudflare-ai automation]", err);
    return NextResponse.json({ error: err.message || "Failed to setup Cloudflare Workers AI" }, { status: 500 });
  }
}
