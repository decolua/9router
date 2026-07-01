import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, deleteModelAlias } from "@/models";
import { AI_MODELS } from "@/shared/constants/models";
import { getCustomModels } from "@/lib/db/repos/aliasRepo.js";

export const dynamic = "force-dynamic";

// GET /api/models/alias - Get all aliases
export async function GET() {
  try {
    const aliases = await getModelAliases();
    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// Cari semua native model yang memiliki nama persis sama dengan `alias` di
// provider selain `targetProvider`. Konflik = client kirim model name polos
// (tanpa prefix provider) akan SELALU di-resolve ke target alias, bocor lintas
// provider walau user sebenarnya menargetkan provider lain.
async function findConflictingNativeModels(alias, targetProvider) {
  const conflicts = [];
  for (const m of AI_MODELS) {
    if (m.model === alias && m.provider !== targetProvider) {
      conflicts.push(`${m.provider}/${m.model}`);
    }
  }
  try {
    const customs = await getCustomModels();
    for (const c of customs) {
      if (c.id === alias && c.providerAlias !== targetProvider) {
        conflicts.push(`${c.providerAlias}/${c.id}`);
      }
    }
  } catch { /* custom models opsional */ }
  return conflicts;
}

// PUT /api/models/alias - Set model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias, force } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    // Konflik: alias name identik dengan nama model native di provider lain.
    // Tanpa guard ini, request bare model name (tanpa prefix provider) akan
    // selalu di-resolve ke alias target → token tercatat ke provider lain,
    // atau 404 saat provider lain tidak punya credential aktif.
    const slashIdx = model.indexOf("/");
    const targetProvider = slashIdx > 0 ? model.slice(0, slashIdx) : null;
    if (targetProvider && !force) {
      const conflicts = await findConflictingNativeModels(alias, targetProvider);
      if (conflicts.length > 0) {
        return NextResponse.json({
          error: `Alias "${alias}" bentrok dengan model native: ${conflicts.join(", ")}. Request tanpa prefix provider akan selalu routing ke "${model}". Pakai alias yang lebih unik, atau kirim ulang dengan { force: true } untuk override.`,
          conflicts,
        }, { status: 409 });
      }
    }

    await setModelAlias(alias, model);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAlias(alias);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting alias:", error);
    return NextResponse.json({ error: "Failed to delete alias" }, { status: 500 });
  }
}
