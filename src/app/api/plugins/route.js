import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { clearPluginCache } from "@/lib/plugins/customPluginsRuntime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const customPlugins = settings.customPlugins || {
      imageVision: { enabled: false, models: [] },
      thinkDeeper: { enabled: false, models: [] },
      speedMode: { enabled: false, models: [] },
    };
    return NextResponse.json({ customPlugins }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Error getting custom plugins:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { customPlugins } = body;
    if (!customPlugins || typeof customPlugins !== "object") {
      return NextResponse.json({ error: "Invalid customPlugins payload" }, { status: 400 });
    }

    const merged = {
      imageVision: {
        enabled: Boolean(customPlugins.imageVision?.enabled),
        models: Array.isArray(customPlugins.imageVision?.models) ? customPlugins.imageVision.models.filter(Boolean) : [],
      },
      thinkDeeper: {
        enabled: Boolean(customPlugins.thinkDeeper?.enabled),
        models: Array.isArray(customPlugins.thinkDeeper?.models) ? customPlugins.thinkDeeper.models.filter(Boolean) : [],
      },
      speedMode: {
        enabled: Boolean(customPlugins.speedMode?.enabled),
        models: Array.isArray(customPlugins.speedMode?.models) ? customPlugins.speedMode.models.filter(Boolean) : [],
      },
    };

    await updateSettings({ customPlugins: merged });
    clearPluginCache();
    return NextResponse.json({ success: true, customPlugins: merged });
  } catch (error) {
    console.error("Error updating custom plugins:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
