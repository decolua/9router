import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { FILTERS } from "./filters.js";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = (FILTERS as Record<string, ((items: unknown[]) => unknown[]) | undefined>)[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const json = await res.json() as JsonValue;
    let raw: JsonValue[] = [];
    if (Array.isArray(json)) {
      raw = json;
    } else if (json !== null && typeof json === "object") {
      const obj = json as Record<string, JsonValue>;
      if (Array.isArray(obj["data"])) raw = obj["data"];
      else if (Array.isArray(obj["models"])) raw = obj["models"];
    }
    const data = filter(raw);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
