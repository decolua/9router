import { NextResponse } from "next/server";
import {
  getFilterDecisions,
  setFilterDecisions,
  deleteFilterDecision,
  clearFilterDecisions,
  addCustomModel,
  deleteCustomModel,
} from "@/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/providers/sync-models/decisions
 * Returns all remembered user filter decisions.
 */
export async function GET() {
  try {
    const decisions = await getFilterDecisions();
    return NextResponse.json({
      decisions,
      count: Object.keys(decisions || {}).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/providers/sync-models/decisions
 * Save user decisions for uncertain/reviewed models and optionally apply them immediately.
 *
 * Body: {
 *   decisions: [
 *     { providerAlias: "openrouter", id: "deepseek-v4-preview", name: "...", action: "keep" | "reject" }
 *   ]
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body?.decisions) ? body.decisions : [];

    if (items.length === 0) {
      return NextResponse.json({ error: "decisions array is required" }, { status: 400 });
    }

    const decisionMap = {};
    let addedCount = 0;
    let rejectedCount = 0;

    for (const item of items) {
      const { providerAlias, id, name, action } = item;
      if (!id || (action !== "keep" && action !== "reject")) continue;

      decisionMap[id] = { decision: action, note: `User manual ${action} from review` };

      if (action === "keep") {
        if (providerAlias) {
          try {
            await addCustomModel({
              providerAlias,
              id,
              type: "llm",
              name: name || id,
            });
            addedCount += 1;
          } catch (err) {
            console.warn(`Failed to add custom model ${providerAlias}/${id}:`, err.message);
          }
        }
      } else if (action === "reject") {
        rejectedCount += 1;
        // If it was previously in custom models, also delete it
        if (providerAlias) {
          try {
            await deleteCustomModel({ providerAlias, id, type: "llm" });
          } catch {
            // Non-critical
          }
        }
      }
    }

    await setFilterDecisions(decisionMap);

    return NextResponse.json({
      ok: true,
      saved: Object.keys(decisionMap).length,
      addedCount,
      rejectedCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/providers/sync-models/decisions
 * Forget filter decisions:
 * Body: { id?: "model-id" } - omit id to clear all.
 */
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.id) {
      await deleteFilterDecision(body.id);
      return NextResponse.json({ ok: true, message: `Forgot decision for ${body.id}` });
    }
    await clearFilterDecisions();
    return NextResponse.json({ ok: true, message: "Cleared all remembered filter decisions" });
  } catch (error) {
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
