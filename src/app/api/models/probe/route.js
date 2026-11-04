import { NextResponse } from "next/server";
import { probeModel, probeModels } from "./capabilityProbe";
import { readProbes, saveProbeResults, clearProbeResults, STALE_AFTER_MS } from "@/lib/probe/store";

export const dynamic = "force-dynamic";
// Probing N models with real upstream calls can outlast the default budget.
export const maxDuration = 300;

function withStaleness(results) {
  const now = Date.now();
  const out = {};
  for (const [model, entry] of Object.entries(results || {})) {
    const age = entry?.probedAt ? now - Date.parse(entry.probedAt) : Infinity;
    out[model] = { ...entry, stale: !(age < STALE_AFTER_MS) };
  }
  return out;
}

/**
 * GET /api/models/probe
 *
 * Stored probe results, so the picker can render capability filters immediately
 * on open instead of re-probing (which costs real upstream calls).
 */
export async function GET() {
  try {
    const { results, updatedAt } = readProbes();
    return NextResponse.json({
      results: withStaleness(results),
      updatedAt,
      count: Object.keys(results).length,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error).slice(0, 240) }, { status: 500 });
  }
}

/**
 * POST /api/models/probe
 *
 * Real-request capability probing. Deliberately a SEPARATE route from
 * /api/models/test: that one is a single-model reachability ping with a
 * { model, kind } contract and five existing callers in the dashboard. This
 * route adds capability discovery (vision / tools) and batch mode without
 * changing that contract.
 *
 * Body:
 *   { model: "openai/gpt-4o", probeVision?, probeTools? }
 *   { models: ["a/b", "c/d"], concurrency?, probeVision?, probeTools? }
 *
 * Results are persisted as each one lands, not only at the end — a batch that
 * times out mid-flight must not throw away the calls already paid for.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { model, models, concurrency, perProvider, timeoutMs, probeVision, probeTools, probeAudio } =
      body || {};

    const opts = {
      probeVision: probeVision !== false,
      probeTools: probeTools !== false,
      // Audio costs an extra upstream call per model, so it is opt-in.
      probeAudio: probeAudio === true,
      ...(Number(timeoutMs) > 0 ? { timeoutMs: Number(timeoutMs) } : {}),
    };

    if (Array.isArray(models)) {
      const cleaned = models.filter((m) => typeof m === "string" && m.trim());
      if (cleaned.length === 0) {
        return NextResponse.json({ error: "models array is empty" }, { status: 400 });
      }

      // Flush in small groups: one write per result would rewrite the whole file
      // N times, one write at the end would lose everything on a timeout.
      let pending = [];
      const flush = () => {
        if (pending.length === 0) return;
        try {
          saveProbeResults(pending);
        } catch {}
        pending = [];
      };

      const results = await probeModels(cleaned, {
        ...opts,
        concurrency,
        perProvider,
        onResult: (r) => {
          pending.push(r);
          if (pending.length >= 10) flush();
        },
      });
      flush();

      const summary = {
        total: results.length,
        ok: results.filter((r) => r.ok).length,
        rateLimited: results.filter((r) => r.failureKind === "rate_limited").length,
        failed: results.filter((r) => !r.ok && r.failureKind !== "rate_limited").length,
        vision: results.filter((r) => r.capabilities?.vision).length,
        tools: results.filter((r) => r.capabilities?.tools).length,
        audioInput: results.filter((r) => r.capabilities?.audioInput).length,
      };
      return NextResponse.json({ results, summary });
    }

    if (typeof model === "string" && model.trim()) {
      const result = await probeModel(model.trim(), opts);
      try {
        saveProbeResults([result]);
      } catch {}
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "Provide `model` (string) or `models` (array)" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error?.message || error).slice(0, 240) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/models/probe
 *
 * Body: { models?: string[] } — omit to clear every stored probe.
 */
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { count, updatedAt } = clearProbeResults(body?.models);
    return NextResponse.json({ ok: true, count, updatedAt });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error).slice(0, 240) }, { status: 500 });
  }
}
