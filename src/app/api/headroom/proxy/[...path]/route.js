import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb.js";
import { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl, parsePortFromUrl } from "@/lib/headroom/detect.js";
import { startHeadroomProxy } from "@/lib/headroom/process.js";

export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DASHBOARD_PREFIX = "/api/headroom/proxy";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

async function getTargetBase() {
  const settings = await getSettings();
  const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Headroom URL must use http or https");
  }
  return target;
}

function buildTargetUrl(base, path, search) {
  const target = new URL(base);
  target.pathname = `/${path.join("/")}`;
  target.search = search;
  return target;
}

function forwardedHeaders(request, target) {
  const headers = new Headers(request.headers);
  for (const header of headers.keys()) {
    if (HOP_BY_HOP_HEADERS.has(header.toLowerCase())) headers.delete(header);
  }
  headers.delete("host");
  // Never leak viewer credentials to a non-loopback Headroom host
  if (!LOOPBACK_HOSTS.has(target.hostname.replace(/^\[|\]$/g, "").toLowerCase())) {
    headers.delete("cookie");
    headers.delete("authorization");
  }
  return headers;
}

function rewriteDashboardHtml(html) {
  return html
    .replace(/(src|href)=(["'])\/dashboard(?=[\/"'\s]|$)/g, `$1=$2${DASHBOARD_PREFIX}/dashboard`)
    .replace(
      /(fetch\(|fetchJson\()(["'])(?=\/(?:stats|health|transformations|settings))/g,
      `$1$2${DASHBOARD_PREFIX}`,
    );
}

async function proxy(request, { params }) {
  try {
    const base = await getTargetBase();
    const { search } = new URL(request.url);
    const path = (await params).path || [];
    const target = buildTargetUrl(base, path, search);
    const method = request.method;
    const hasBody = !["GET", "HEAD"].includes(method);

    let response;
    try {
      response = await fetch(target, {
        method,
        headers: forwardedHeaders(request, target),
        body: hasBody ? request.body : undefined,
        duplex: hasBody ? "half" : undefined,
        redirect: "manual",
      });
    } catch (fetchError) {
      const settings = await getSettings();
      const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
      if (isLoopbackHeadroomUrl(url) && method === "GET") {
        try {
          const port = parsePortFromUrl(url);
          await startHeadroomProxy({
            port,
            codeAware: settings.headroomCodeAware === true,
            kompress: settings.headroomKompress !== false,
          });
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 500));
            try {
              response = await fetch(target, {
                method,
                headers: forwardedHeaders(request, target),
                redirect: "manual",
              });
              if (response) break;
            } catch {}
          }
        } catch {}
      }
      if (!response) {
        const accept = request.headers.get("accept") || "";
        if (accept.includes("text/html")) {
          return new NextResponse(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Headroom Offline</title><style>body{background:#111;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;padding:2rem;background:#1e1e1e;border-radius:8px;border:1px solid #333}a{color:#22d3ee;text-decoration:none}a:hover{text-decoration:underline}</style></head><body><div><h2>Headroom proxy is not running</h2><p>Please start the proxy from <a href="/dashboard/token-saver">Token Saver settings</a>.</p><p style="margin-top:1rem"><button onclick="location.reload()" style="background:#22d3ee;color:#000;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-weight:bold">Retry</button></p></div></body></html>`,
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
        return NextResponse.json({ error: "Headroom proxy is not running: " + fetchError.message }, { status: 502 });
      }
    }

    const headers = new Headers(response.headers);
    for (const header of headers.keys()) {
      if (HOP_BY_HOP_HEADERS.has(header.toLowerCase())) headers.delete(header);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      headers.delete("content-length");
      return new NextResponse(rewriteDashboardHtml(await response.text()), {
        status: response.status,
        headers,
      });
    }

    return new NextResponse(response.body, { status: response.status, headers });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
