import { NextResponse } from "next/server";
import { getEnabledModels, setEnabledModels } from "@/lib/enabledModelsDb";
import { enableModels } from "@/lib/disabledModelsDb";

export const dynamic = "force-dynamic";

// GET /api/models/enabled?providerAlias=xxx
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const all = await getEnabledModels();
    if (providerAlias) return NextResponse.json({ ids: all[providerAlias] || [] });
    return NextResponse.json({ enabled: all });
  } catch (error) {
    console.log("Error fetching enabled models:", error);
    return NextResponse.json({ error: "Failed to fetch enabled models" }, { status: 500 });
  }
}

// PUT /api/models/enabled  body: { providerAlias, ids: [...] }
// Replaces the allowlist for one provider alias; an empty ids[] clears it,
// which means "no restriction — every model the provider exposes is visible".
export async function PUT(request) {
  try {
    const { providerAlias, ids } = await request.json();
    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }
    await setEnabledModels(providerAlias, ids);

    // /v1/models applies the disabled-model blacklist on top of this allowlist,
    // so a whitelisted id that is also blacklisted would silently stay hidden.
    // Saving an allowlist therefore drops those ids from the blacklist.
    const cleaned = ids.filter((id) => typeof id === "string" && id.trim() !== "");
    if (cleaned.length > 0) await enableModels(providerAlias, cleaned);

    return NextResponse.json({ success: true, ids: cleaned });
  } catch (error) {
    console.log("Error setting enabled models:", error);
    return NextResponse.json({ error: "Failed to set enabled models" }, { status: 500 });
  }
}

// DELETE /api/models/enabled?providerAlias=xxx
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    await setEnabledModels(providerAlias, []);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error clearing enabled models:", error);
    return NextResponse.json({ error: "Failed to clear enabled models" }, { status: 500 });
  }
}
