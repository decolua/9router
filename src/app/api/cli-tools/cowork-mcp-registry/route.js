"use server";

import { NextResponse } from "next/server";

const REGISTRY_URL = "https://api.anthropic.com/mcp-registry/v0/servers";
const VISIBILITY = "commercial,gsuite,gsuite-google";
const CACHE_TTL_MS = 60 * 60 * 1000;
const G_KEY = "__9routerCoworkMcpRegistryCache";

function gcache() {
  if (!globalThis[G_KEY]) globalThis[G_KEY] = { ts: 0, data: null };
  return globalThis[G_KEY];
}

// Filter out claude.ai-mediated servers (broken in 3p) and tenant-required entries.
function isDirectConnect(url) {
  if (!url || typeof url !== "string") return false;
  if (/^https?:\/\/[^/]*\bmcp\.claude\.com\b/i.test(url)) return false;
  if (/^https?:\/\/api\.anthropic\.com\/mcp\b/i.test(url)) return false;
  if (/[<{]/.test(url)) return false;
  return /^https:\/\//i.test(url);
}

async function fetchAll() {
  const out = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const url = `${REGISTRY_URL}?limit=500&visibility=${VISIBILITY}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) break;
    const j = await r.json();
    for (const item of j.servers || []) {
      const s = item.server || {};
      const meta = item._meta?.["com.anthropic.api/mcp-registry"] || {};
      const remote = (s.remotes || [])[0];
      if (!remote?.url || !isDirectConnect(remote.url)) continue;
      if (meta.requiredFields?.length) continue;
      const transport = remote.type === "sse" ? "sse" : "http";
      const toolNames = Array.isArray(meta.toolNames) ? meta.toolNames : [];
      out.push({
        name: s.name,
        slug: meta.slug || s.name,
        title: s.title || meta.displayName || s.name,
        description: s.description || meta.oneLiner || "",
        url: remote.url,
        transport,
        oauth: !meta.isAuthless,
        toolNames,
        toolCount: toolNames.length,
        iconUrl: meta.iconUrl || null,
      });
    }
    cursor = j.metadata?.nextCursor;
    if (!cursor) break;
  }
  // Dedupe by url
  const seen = new Set();
  return out.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("refresh") === "1";
  const cache = gcache();
  if (!force && cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ cached: true, ...cache.data });
  }
  try {
    const servers = await fetchAll();
    const data = { servers, total: servers.length };
    cache.ts = Date.now();
    cache.data = data;
    return NextResponse.json({ cached: false, ...data });
  } catch (e) {
    return NextResponse.json({ error: e.message, servers: [], total: 0 }, { status: 500 });
  }
}
