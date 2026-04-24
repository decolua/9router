import { NextResponse } from "next/server";
import { getMitmAlias, setMitmAliasAll } from "@/lib/localDb";
import { getMitmStatus } from "@/mitm/manager";

// GET - Get MITM aliases for a tool
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const toolName = searchParams.get("tool");
    const aliases = await getMitmAlias(toolName || undefined);
    return NextResponse.json({ aliases });
  } catch (error: any) {
    console.log("Error fetching MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT - Save MITM aliases for a specific tool
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const { tool, mappings } = await request.json();

    if (!tool || !mappings || typeof mappings !== "object") {
      return NextResponse.json({ error: "tool and mappings required" }, { status: 400 });
    }

    // DNS status check removed to allow pre-configuration
    /*
    const status = await getMitmStatus();
    if (!status.dnsStatus || !status.dnsStatus[tool]) {
      return NextResponse.json(
        { error: `DNS must be enabled for ${tool} before editing model mappings` },
        { status: 403 }
      );
    }
    */

    const filtered: any = {};
    for (const [alias, model] of Object.entries(mappings)) {
      if (model && (model as string).trim()) {
        filtered[alias] = (model as string).trim();
      }
    }

    await setMitmAliasAll(tool, filtered);
    return NextResponse.json({ success: true, aliases: filtered });
  } catch (error: any) {
    console.log("Error saving MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to save aliases" }, { status: 500 });
  }
}
