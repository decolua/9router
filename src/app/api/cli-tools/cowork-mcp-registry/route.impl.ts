"use server";

import { NextRequest, NextResponse } from "next/server";

const REGISTRY_URL = "https://api.anthropic.com/mcp-registry/v0/servers";
const VISIBILITY = "commercial,gsuite,gsuite-google";
const CACHE_TTL_MS = 60 * 60 * 1000;

type RegistryEntry = {
  name: string;
  slug: string;
  title: string;
  description: string;
  url: string;
  transport: string;
  oauth: boolean;
  toolNames: string[];
  toolCount: number;
  iconUrl: string | null;
};

type CacheShape = {
  ts: number;
  data: { servers: RegistryEntry[]; total: number } | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __9routerCoworkMcpRegistryCache: CacheShape | undefined;
}

function gcache() {
  if (!globalThis.__9routerCoworkMcpRegistryCache) {
    globalThis.__9routerCoworkMcpRegistryCache = { ts: 0, data: null };
  }
  return globalThis.__9routerCoworkMcpRegistryCache;
}

// Filter out claude.ai-mediated servers (broken in 3p) and tenant-required entries.
function isDirectConnect(url: string | null | undefined) {
  if (!url || typeof url !== "string") return false;
  if (/^https?:\/\/[^/]*\bmcp\.claude\.com\b/i.test(url)) return false;
  if (/^https?:\/\/api\.anthropic\.com\/mcp\b/i.test(url)) return false;
  if (/[<{]/.test(url)) return false;
  return /^https:\/\//i.test(url);
}

async function fetchAll() {
  const out: RegistryEntry[] = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const url = `${REGISTRY_URL}?limit=500&visibility=${VISIBILITY}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) break;
    const j = await r.json() as {
      servers?: Array<{
        server?: {
          name: string;
          title?: string;
          description?: string;
          remotes?: Array<{ url?: string; type?: string }>;
        };
        _meta?: {
          "com.anthropic.api/mcp-registry"?: {
            slug?: string;
            displayName?: string;
            oneLiner?: string;
            requiredFields?: string[];
            toolNames?: string[];
            iconUrl?: string;
            isAuthless?: boolean;
          };
        };
      }>;
      metadata?: { nextCursor?: string };
    };
    for (const item of j.servers ?? []) {
      const s = item.server;
      if (!s?.name) continue;
      const meta = item._meta?.["com.anthropic.api/mcp-registry"] ?? {};
      const remote = (s.remotes ?? [])[0];
      if (!remote?.url || !isDirectConnect(remote.url)) continue;
      if (meta.requiredFields?.length) continue;
      const transport = remote.type === "sse" ? "sse" : "http";
      const toolNames = Array.isArray(meta.toolNames) ? meta.toolNames : [];
      out.push({
        name: s.name,
        slug: meta.slug ?? s.name,
        title: s.title ?? meta.displayName ?? s.name,
        description: s.description ?? meta.oneLiner ?? "",
        url: remote.url,
        transport,
        oauth: !meta.isAuthless,
        toolNames,
        toolCount: toolNames.length,
        iconUrl: meta.iconUrl ?? null,
      });
    }
    cursor = j.metadata?.nextCursor ?? "";
    if (!cursor) break;
  }
  // Dedupe by url
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

export async function GET(request: NextRequest) {
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
    return NextResponse.json({ error: (e as Error).message, servers: [], total: 0 }, { status: 500 });
  }
}
