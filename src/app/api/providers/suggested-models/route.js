import { NextResponse } from "next/server";
import { normalizeChutesModels, parseOpenAIStyleModels } from "@/shared/utils/providerModelCatalog";

export const dynamic = "force-dynamic";

const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models
      .filter((m) => m.id?.endsWith("-free"))
      .map((m) => ({ id: m.id, name: m.id })),

  "chutes-all": (models) => normalizeChutesModels(models),
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ data: [], error: `Failed to fetch provider models: ${res.status}` });
    }
    const json = await res.json();
    const raw = parseOpenAIStyleModels(json);
    const data = filter(Array.isArray(raw) ? raw : []);
    return NextResponse.json({ data, error: null });
  } catch (error) {
    return NextResponse.json({ data: [], error: error?.message || "Failed to fetch provider models" });
  }
}
