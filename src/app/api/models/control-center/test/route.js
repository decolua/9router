import { NextResponse } from "next/server";
import { pingModelByKind } from "@/app/api/models/test/ping";
import {
  readControlCenter,
  writeControlCenter,
} from "@/lib/modelControlCenter/store.js";

export const dynamic = "force-dynamic";

const TESTABLE_KINDS = new Set(["llm", "embedding", "image", "stt"]);
const CONCURRENCY = 3;
const MAX_TESTS = 250;

function pickTargets(state, body = {}) {
  const targets = [];

  for (const provider of Object.values(state.providers || {})) {
    if (body.provider && body.provider !== provider.providerId) continue;

    for (const model of Object.values(provider.models || {})) {
      if (model.stale) continue;
      if (body.model && body.model !== model.fullModel && body.model !== model.id) continue;
      if (body.scope === "changed" && !model.changed) continue;

      targets.push({
        providerId: provider.providerId,
        modelId: model.id,
        fullModel: model.fullModel,
        kind: model.kind || "llm",
      });
    }
  }

  return targets.slice(0, MAX_TESTS);
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const state = readControlCenter();
    const targets = pickTargets(state, body);

    if (targets.length === 0) {
      return NextResponse.json({ success: true, tested: 0, state });
    }

    const queue = [...targets];
    const results = [];

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      async () => {
        while (queue.length) {
          const target = queue.shift();
          const provider = state.providers[target.providerId];
          const model = provider?.models?.[target.modelId];
          if (!model) continue;

          if (!TESTABLE_KINDS.has(target.kind)) {
            model.health = {
              status: "unsupported",
              latencyMs: null,
              testedAt: new Date().toISOString(),
              error: `No global ping implementation for kind=${target.kind}`,
            };
            model.changed = false;
            results.push({ ...target, ...model.health });
            continue;
          }

          const result = await pingModelByKind(target.fullModel, target.kind);
          model.health = {
            status: result.ok ? "ok" : "error",
            latencyMs: result.latencyMs ?? null,
            testedAt: new Date().toISOString(),
            statusCode: result.status ?? null,
            error: result.error || null,
            note: result.note || null,
          };
          model.changed = false;
          results.push({ ...target, ...model.health });
        }
      },
    );

    await Promise.all(workers);
    state.testedAt = new Date().toISOString();
    const saved = writeControlCenter(state);

    return NextResponse.json({
      success: true,
      tested: results.length,
      results,
      state: saved,
    });
  } catch (error) {
    console.log("[modelControlCenter] test failed:", error);
    return NextResponse.json(
      { error: error?.message || "Test failed" },
      { status: 500 },
    );
  }
}
