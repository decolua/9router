"use server";

import { NextResponse } from "next/server";
import { getMitmAlias, setMitmAliasAll } from "@/models";
import { getMitmStatus } from "@/mitm/manager.cjs";

// Reserved key for MITM per-tool metadata
const MITM_META_KEY = "__meta__";

// GET - Get MITM aliases for a tool
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const toolName = searchParams.get("tool");
    const aliases = await getMitmAlias(toolName || undefined);

    if (!toolName) {
      return NextResponse.json({ aliases });
    }

    const meta = aliases?.[MITM_META_KEY] || {};
    const cleanedAliases = Object.fromEntries(
      Object.entries(aliases || {}).filter(([key]) => key !== MITM_META_KEY)
    );

    return NextResponse.json({
      aliases: cleanedAliases,
      alwaysFallbackEnabled: !!meta.alwaysFallbackEnabled,
      alwaysFallbackModel: meta.alwaysFallbackModel || "",
    });
  } catch (error) {
    console.log("Error fetching MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT - Save MITM aliases for a specific tool
export async function PUT(request) {
  try {
    const {
      tool,
      mappings,
      alwaysFallbackEnabled = false,
      alwaysFallbackModel = "",
    } = await request.json();

    if (!tool || !mappings || typeof mappings !== "object") {
      return NextResponse.json({ error: "tool and mappings required" }, { status: 400 });
    }

    // Check if DNS is enabled for this tool
    const status = await getMitmStatus();
    if (!status.dnsStatus || !status.dnsStatus[tool]) {
      return NextResponse.json(
        { error: `DNS must be enabled for ${tool} before editing model mappings` },
        { status: 403 }
      );
    }

    const filtered = {};
    for (const [alias, model] of Object.entries(mappings)) {
      if (model && model.trim()) {
        filtered[alias] = model.trim();
      }
    }

    const fallbackModel = alwaysFallbackModel?.trim() || "";
    const payload = {
      ...filtered,
      [MITM_META_KEY]: {
        alwaysFallbackEnabled: !!alwaysFallbackEnabled,
        alwaysFallbackModel: fallbackModel,
      },
    };

    await setMitmAliasAll(tool, payload);
    return NextResponse.json({
      success: true,
      aliases: filtered,
      alwaysFallbackEnabled: !!alwaysFallbackEnabled,
      alwaysFallbackModel: fallbackModel,
    });
  } catch (error) {
    console.log("Error saving MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to save aliases" }, { status: 500 });
  }
}
