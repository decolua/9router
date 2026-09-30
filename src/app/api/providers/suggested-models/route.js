import { NextResponse } from "next/server";
import { FILTERS, FALLBACK_SUGGESTIONS } from "./filters.js";

export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 15000;
const UPSTREAM_UNAVAILABLE_MESSAGE = "Live model list is unavailable, showing built-in models instead.";

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

  const fallback = FALLBACK_SUGGESTIONS[type] ?? [];
  const unavailable = (message) =>
    NextResponse.json({ data: fallback, error: message || UPSTREAM_UNAVAILABLE_MESSAGE });

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) {
      return unavailable();
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const data = filter(Array.isArray(raw) ? raw : []);
    if (data.length === 0 && fallback.length > 0) {
      return unavailable();
    }
    return NextResponse.json({ data });
  } catch {
    return unavailable();
  }
}
