import { NextResponse } from "next/server";
import { pingModelByKind } from "@/app/api/models/test/ping";
import {
  readControlCenter,
  writeControlCenter,
} from "@/lib/modelControlCenter/store.js";

export const dynamic = "force-dynamic";

const TESTABLE_KINDS = new Set(["llm", "embedding", "image", "stt"]);
const EXPENSIVE_KINDS = new Set(["image"]);
const CONCURRENCY = 3;
const MAX_TESTS = 18;

function testedAtValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickTargets(state, body = {}) {
  const targets = [];
  let skippedExpensive = 0;

  for (const provider of Object.values(state.providers || {})) {
    if (body.provider && body.provider !== provider.providerId) continue;

    for (const model of Object.values(provider.models || {})) {
      if (model.stale) continue;

      if (
        body.model
        && body.model !== model.fullModel
        && body.model !== model.id
      ) {
        continue;
      }

      if (body.scope === "changed" && !model.changed) continue;

      if (
        body.scope === "failed"
        && model.health?.status !== "error"
      ) {
        continue;
      }

      const kind = model.kind || "llm";

      if (
        EXPENSIVE_KINDS.has(kind)
        && body.includeExpensive !== true
      ) {
        skippedExpensive += 1;
        continue;
      }

      targets.push({
        providerId: provider.providerId,
        modelId: model.id,
        fullModel: model.fullModel,
        kind,
        testedAt: model.health?.testedAt || null,
      });
    }
  }

  // Untested models first. Afterwards, oldest health result first.
  targets.sort((a, b) => {
    const timeDiff =
      testedAtValue(a.testedAt) - testedAtValue(b.testedAt);

    if (timeDiff !== 0) return timeDiff;

    return a.fullModel.localeCompare(b.fullModel);
  });

  return {
    targets: targets.slice(0, MAX_TESTS),
    skippedExpensive,
  };
}

function healthErrorFromException(error, startedAt) {
  const timedOut =
    error?.name === "TimeoutError"
    || error?.name === "AbortError";

  return {
    status: "error",
    latencyMs: Date.now() - startedAt,
    testedAt: new Date().toISOString(),
    statusCode: null,
    error: timedOut
      ? "Health probe timed out after 15s"
      : (error?.message || "Health probe failed"),
    note: null,
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const state = readControlCenter();

    const {
      targets,
      skippedExpensive,
    } = pickTargets(state, body);

    if (targets.length === 0) {
      return NextResponse.json({
        success: true,
        tested: 0,
        skippedExpensive,
        remainingChanged: state.summary?.changed || 0,
        remainingPending: state.summary?.pending || 0,
        remainingFailed: state.summary?.failed || 0,
        batchLimit: MAX_TESTS,
        state,
      });
    }

    const queue = [...targets];
    const results = [];

    const workers = Array.from(
      {
        length: Math.min(CONCURRENCY, queue.length),
      },
      async () => {
        while (queue.length) {
          const target = queue.shift();
          if (!target) continue;

          const provider =
            state.providers[target.providerId];

          const model =
            provider?.models?.[target.modelId];

          if (!model) continue;

          if (!TESTABLE_KINDS.has(target.kind)) {
            model.health = {
              status: "unsupported",
              latencyMs: null,
              testedAt: new Date().toISOString(),
              statusCode: null,
              error:
                `No global ping implementation for kind=${target.kind}`,
              note: null,
            };

            model.changed = false;

            results.push({
              ...target,
              ...model.health,
            });

            continue;
          }

          const startedAt = Date.now();

          try {
            const result = await pingModelByKind(
              target.fullModel,
              target.kind,
            );

            model.health = {
              status: result.ok ? "ok" : "error",
              latencyMs: result.latencyMs ?? null,
              testedAt: new Date().toISOString(),
              statusCode: result.status ?? null,
              error: result.error || null,
              note: result.note || null,
            };
          } catch (error) {
            model.health =
              healthErrorFromException(error, startedAt);
          }

          // The model has now received a real probe attempt,
          // successful or otherwise.
          model.changed = false;

          results.push({
            ...target,
            ...model.health,
          });
        }
      },
    );

    await Promise.all(workers);

    state.testedAt = new Date().toISOString();

    const saved = writeControlCenter(state);

    return NextResponse.json({
      success: true,
      tested: results.length,
      skippedExpensive,
      remainingChanged: saved.summary.changed,
      remainingPending: saved.summary.pending,
      remainingFailed: saved.summary.failed,
      batchLimit: MAX_TESTS,
      results,
      state: saved,
    });
  } catch (error) {
    console.log(
      "[modelControlCenter] test failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error?.message
          || "Test failed",
      },
      {
        status: 500,
      },
    );
  }
}
