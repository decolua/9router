import { NextResponse } from "next/server";
import { getComboByName } from "@/lib/localDb";
import { compactCeiling, modelContextWindow } from "open-sse/services/combo.js";
import { COMPACT_HEADROOM_RATIO } from "open-sse/config/errorConfig.js";

export const dynamic = "force-dynamic";

// What window should the CLIENT believe it has?
//
// A combo is not one model, and its head changes every few minutes as quota
// moves. Claude Code, meanwhile, reads a single number once at startup —
// CLAUDE_CODE_AUTO_COMPACT_WINDOW / autoCompactWindow — and compacts at 80% of
// it. Pin that number to a guess and it is wrong in both directions: too high
// and the conversation outgrows the members that could serve it, too low and it
// compacts at a fraction of a 1M window. Both were observed on this box in one
// evening.
//
// So the client stops guessing and asks. The router is the only party that
// knows which member is about to answer and which one it would rotate into, and
// it already computes exactly that for its own 413 — this endpoint is that same
// calculation, exposed so the client's own compaction agrees with the router's
// instead of racing it.
//
// Read-only, no credentials, no request bodies. It reports the shape of the
// pool, which the caller is about to be served by anyway.
export async function GET(request) {
  const name = new URL(request.url).searchParams.get("combo");
  if (!name) return NextResponse.json({ error: "combo is required" }, { status: 400 });

  const combo = await getComboByName(name);
  if (!combo) {
    // Not a combo — a bare model id is legitimate here, and its own window is
    // the whole answer.
    const window = modelContextWindow(name);
    if (!window) return NextResponse.json({ error: `unknown combo or model: ${name}` }, { status: 404 });
    return NextResponse.json({ combo: null, model: name, head: window, next: 0, ceiling: Math.floor(window * COMPACT_HEADROOM_RATIO), clientWindow: window, headroomRatio: COMPACT_HEADROOM_RATIO });
  }

  const models = Array.isArray(combo.models) ? combo.models : [];
  const { ceiling, head, next } = compactCeiling(models, COMPACT_HEADROOM_RATIO);

  // `clientWindow` is the number to hand Claude Code, and it is NOT `head`.
  // Claude Code applies its own 80% to whatever window it is given, so the
  // value that makes its compaction land exactly on the router's ceiling is
  // ceiling / 0.8 — never above the head's real window.
  //
  // That single division is what encodes both halves of the rule:
  //   next >= 80% of head  ->  ceiling is 80% of head  ->  clientWindow = head,
  //                            and the client compacts at 80% of the answering
  //                            model's window. The ordinary case.
  //   next <  80% of head  ->  ceiling is next         ->  clientWindow = next/0.8,
  //                            and the client compacts as soon as the request
  //                            outgrows the member we would rotate into.
  //
  // Without it the client only learns about the early case by being told
  // mid-turn with a 413, which works but spends a round trip to find out
  // something the router already knew before the turn started.
  const clientWindow = ceiling > 0 ? Math.min(head, Math.floor(ceiling / COMPACT_HEADROOM_RATIO)) : 0;

  return NextResponse.json({
    combo: name,
    model: models[0] ?? null,
    head,
    next,
    ceiling,
    clientWindow,
    headroomRatio: COMPACT_HEADROOM_RATIO,
    members: models.length,
  });
}
