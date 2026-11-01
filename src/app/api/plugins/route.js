import { NextResponse } from "next/server";
import { CUSTOM_PLUGIN_KEYS } from "@/shared/constants/pluginKeys";
import { getSettings, updateSettings } from "@/lib/localDb";
import { clearPluginCache } from "@/lib/plugins/customPluginsRuntime";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ customPlugins: {} }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT() {
  return NextResponse.json({ success: true, customPlugins: {} });
}
