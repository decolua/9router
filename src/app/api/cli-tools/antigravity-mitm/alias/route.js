"use server";

import { NextResponse } from "next/server";
import { getMitmAlias, setMitmAliasAll } from "@/models";
import { getMitmStatus } from "@/mitm/manager";
import { writeAliasForTool } from "@/lib/mitmAliasCache";
import aliasConfig from "@/mitm/aliasConfig";

const { normalizeAliasMappings, hasInvalidReasoningEffort } = aliasConfig;

// GET - Get MITM aliases for a tool
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const toolName = searchParams.get("tool");
    const aliases = await getMitmAlias(toolName || undefined);
    return NextResponse.json({ aliases: normalizeAliasMappings(aliases) });
  } catch (error) {
    console.log("Error fetching MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT - Save MITM aliases for a specific tool
export async function PUT(request) {
  try {
    const { tool, mappings } = await request.json();

    if (!tool || !mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
      return NextResponse.json({ error: "tool and mappings required" }, { status: 400 });
    }
    if (hasInvalidReasoningEffort(mappings)) {
      return NextResponse.json({ error: "Invalid reasoning effort" }, { status: 400 });
    }

    // Check if DNS is enabled for this tool
    const status = await getMitmStatus();
    if (!status.dnsStatus || !status.dnsStatus[tool]) {
      return NextResponse.json(
        { error: `DNS must be enabled for ${tool} before editing model mappings` },
        { status: 403 }
      );
    }

    const filtered = normalizeAliasMappings(mappings);
    await setMitmAliasAll(tool, filtered);
    writeAliasForTool(tool, filtered);
    return NextResponse.json({ success: true, aliases: filtered });
  } catch (error) {
    console.log("Error saving MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to save aliases" }, { status: 500 });
  }
}
