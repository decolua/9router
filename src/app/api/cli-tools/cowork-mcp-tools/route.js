"use server";

import { NextResponse } from "next/server";
import { assertPublicUrlResolved } from "@/shared/utils/ssrfGuard.js";
import { isLocalRequest } from "@/dashboardGuard";

const TIMEOUT_MS = 8000;

// SSRF-safe fetch for MCP probing: follow redirects manually so each hop target
// is re-validated through assertPublicUrlResolved before being requested.
const MAX_MCP_REDIRECTS = 5;
async function fetchValidated(url, options, redirectsLeft = MAX_MCP_REDIRECTS) {
  const res = await fetch(url, { ...options, redirect: "manual" });
  const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
  if (!location) return res;
  if (redirectsLeft <= 0) throw new Error("Blocked URL: too many redirects");
  const nextUrl = new URL(location, url).toString();
  await assertPublicUrlResolved(nextUrl);
  await res.arrayBuffer().catch(() => {});
  return fetchValidated(nextUrl, options, redirectsLeft - 1);
}

// Probe MCP server: initialize + tools/list. No auth header — works for authless servers.
// OAuth servers return 401, signal client to skip tool listing.
async function probeMcp(url) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    // Step 1: initialize
    const initRes = await fetchValidated(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "9router", version: "1" } },
      }),
      signal: ac.signal,
    });
    if (initRes.status === 401 || initRes.status === 403) {
      return { requiresAuth: true, tools: [] };
    }
    if (!initRes.ok) {
      return { error: `init ${initRes.status}`, tools: [] };
    }
    const sessionId = initRes.headers.get("mcp-session-id") || "";
    await initRes.text().catch(() => {});

    const listHeaders = { ...headers };
    if (sessionId) listHeaders["mcp-session-id"] = sessionId;

    // Step 2: notifications/initialized (required by spec before tools/list)
    await fetchValidated(url, {
      method: "POST",
      headers: listHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: ac.signal,
    }).catch(() => {});

    // Step 3: tools/list
    const listRes = await fetchValidated(url, {
      method: "POST",
      headers: listHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      signal: ac.signal,
    });
    if (listRes.status === 401 || listRes.status === 403) {
      return { requiresAuth: true, tools: [] };
    }
    const ct = listRes.headers.get("content-type") || "";
    let parsed;
    if (ct.includes("text/event-stream")) {
      // Parse SSE: each "data: {...}" line is a JSON-RPC message
      const text = await listRes.text();
      const dataLines = text.split("\n").filter((l) => l.startsWith("data:"));
      for (const line of dataLines) {
        try {
          const obj = JSON.parse(line.replace(/^data:\s*/, ""));
          if (obj?.id === 2 && obj.result) { parsed = obj; break; }
        } catch { /* skip */ }
      }
    } else {
      parsed = await listRes.json().catch(() => null);
    }
    const tools = parsed?.result?.tools || [];
    return {
      tools: tools.map((t) => ({ name: t.name, description: t.description || "" })),
    };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message, tools: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }
    // SSRF guard for remote callers; local host keeps self-hosted MCP servers.
    if (!isLocalRequest(request)) {
      try {
        await assertPublicUrlResolved(url);
      } catch {
        return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
      }
    }
    const result = await probeMcp(url);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message, tools: [] }, { status: 500 });
  }
}
