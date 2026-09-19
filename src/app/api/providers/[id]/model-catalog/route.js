import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import {
  MANUAL_SYNC_COOLDOWN_MS,
  catalogStatus,
  getConnectionCatalog,
  syncConnectionCatalog,
} from "@/lib/modelSync/connectionCatalog.js";

export const dynamic = "force-dynamic";

function summarize(catalog) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const counts = { free: 0, credits: 0, paid: 0, unknown: 0 };
  let unavailable = 0;
  let pending = 0;
  for (const model of models) {
    if (model?.availability === "unavailable") { unavailable++; continue; }
    if (model?.availability === "temporarily-absent") pending++;
    if (Object.hasOwn(counts, model?.tier)) counts[model.tier]++;
    else counts.unknown++;
  }
  return {
    total: models.length,
    available: models.length - unavailable,
    unavailable,
    pending,
    ...counts,
  };
}

export async function GET(_request, { params }) {
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const catalog = getConnectionCatalog(connection);
  // No credentials or raw provider payloads leave this route: the stored
  // catalog holds only { id, name, tier, pricing, contextLength,
  // capabilities, kind, availability } per model.
  return NextResponse.json({
    connectionId: id,
    status: catalogStatus(connection),
    counts: summarize(catalog),
    ...catalog,
  });
}

export async function POST(_request, { params }) {
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  // Manual by definition (the dashboard "Models" button): the
  // CONNECTION_MODEL_SYNC=off kill switch never suppresses this (T1.5 M4).
  // Single-flight + short cooldown are handled inside syncConnectionCatalog,
  // so an overlapping scheduler sync can't race this write and rewind the
  // missing-model counters (T1.5 M5).
  const result = await syncConnectionCatalog(connection, { cooldownMs: MANUAL_SYNC_COOLDOWN_MS });
  const fresh = result.updated ? getConnectionCatalog(await getProviderConnectionById(id)) : null;
  return NextResponse.json(
    { ...result, ...(fresh ? { status: catalogStatus({ modelCatalog: fresh }), counts: summarize(fresh), catalog: fresh } : {}) },
    { status: result.error ? 502 : 200 },
  );
}
