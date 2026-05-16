import { NextResponse } from "next/server";

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
};

const ALLOWED_HOSTS = {
  "openrouter-free": ["openrouter.ai"],
  "opencode-free": ["opencode.ai", "models.dev"],
};

function isAllowedUrl(urlString, type) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_HOSTS[type] || [];
  return allowed.some((h) => hostname === h || hostname.endsWith("." + h));
}

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

  if (!isAllowedUrl(url, type)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const data = filter(Array.isArray(raw) ? raw : []);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  } finally {
    clearTimeout(timeout);
  }
}
