import { NextResponse } from "next/server";
import { getComboByName } from "@/lib/localDb";
import { compactCeiling, modelContextWindow } from "open-sse/services/combo.js";
import { COMPACT_HEADROOM_RATIO } from "open-sse/config/errorConfig.js";

export const dynamic = "force-dynamic";

// How recently a member must have answered to be treated as the one serving.
// Long enough to survive a quiet stretch between turns, short enough that a
// model which died an hour ago stops speaking for the pool.
const RECENT_SERVE_MS = 30 * 60 * 1000;

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

  let models = Array.isArray(combo.models) ? combo.models : [];

  // Put the member that is ACTUALLY answering at the head.
  //
  // compactCeiling skips members that are quota-banned or cooling down, because
  // both are cheap local checks. It cannot see the third reason a member is
  // passed over — "no account has capacity for it right now" — which comes from
  // an async probe inside the cascade. On this box that gap is not academic:
  // Yggdrasil's list head is ag/claude-opus-4-6-thinking, which Antigravity caps
  // at 200K and which is skipped for account capacity on almost every turn,
  // while ag/gemini-pro-agent (1,048,576) does the answering. Reporting the list
  // head would tell the client its window is 200K when the model serving it
  // holds five times that — the operator watched exactly that happen and said
  // so: "the model that handles in the hud always gemini-pro-default and never
  // change."
  //
  // The routing seam already records who answered: modelHealth carries lastOkAt
  // per routed id, written on every successful cascade attempt. That is a fact
  // about what happened rather than a prediction about what will, so a member
  // that has served inside the recency window is promoted to the front and the
  // rest keep their order behind it. If nothing has answered recently the list
  // order stands, which is the old behaviour.
  try {
    const { getModelHealthWindow } = await import("@/lib/db/index.js");
    const since = Date.now() - RECENT_SERVE_MS;
    const rows = await getModelHealthWindow(1);
    const lastOk = new Map(
      rows.filter((r) => r.lastOkAt && Date.parse(r.lastOkAt) >= since).map((r) => [r.modelId, Date.parse(r.lastOkAt)])
    );
    if (lastOk.size) {
      const served = models.filter((m) => lastOk.has(m)).sort((a, b) => lastOk.get(b) - lastOk.get(a));
      if (served.length) models = [...served, ...models.filter((m) => !lastOk.has(m))];
    }
  } catch {
    // Health table missing or unreadable: fall back to the combo's own order.
    // A stale head is worse than a wrong one only if it stops the answer.
  }

  // No request in hand here, so no size to fit: inputTokens 0 makes the first
  // live member the head, which is the right answer for "what window should the
  // client adopt" — the client is asking before it has a request either.
  const { ceiling, head, next } = compactCeiling(models, COMPACT_HEADROOM_RATIO, 0);

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
