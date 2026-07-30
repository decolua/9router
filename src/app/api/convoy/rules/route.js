import { NextResponse } from "next/server";
import { getRules, saveRule, deleteRule } from "@/lib/db/repos/rulesRepo.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/convoy/rules - List all rules
 */
export async function GET() {
  try {
    const rules = await getRules();
    return NextResponse.json({ items: rules });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/convoy/rules - Create or update a rule
 * Body: { id?, name, enabled, priority, matchType, action, pattern, replacement, caseSensitive }
 * If id is provided and exists, it updates; otherwise creates.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.name && !body.id) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.pattern) {
      return NextResponse.json({ error: "pattern is required" }, { status: 400 });
    }
    if (!['literal', 'regex'].includes(body.matchType || 'literal')) {
      return NextResponse.json({ error: "invalid matchType" }, { status: 400 });
    }
    if (!['replace', 'delete'].includes(body.action || 'replace')) {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
    if (body.matchType === 'regex') {
      try { new RegExp(body.pattern); } catch (error) {
        return NextResponse.json({ error: `invalid regex: ${error.message}` }, { status: 400 });
      }
    }
    body.providerIds = Array.isArray(body.providerIds)
      ? [...new Set(body.providerIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
      : [];
    const saved = await saveRule(body);
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/**
 * DELETE /api/convoy/rules - Delete a rule
 * Query: ?id=xxx
 */
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    await deleteRule(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
