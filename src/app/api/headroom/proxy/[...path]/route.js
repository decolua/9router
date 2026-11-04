import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";

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

    const response = await fetch(target, {
      method,
      headers: forwardedHeaders(request, target),
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
    });

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
    if (request.headers.get("accept")?.includes("text/html")) {
      return new NextResponse(
        "<!DOCTYPE html><html><body><h2>Headroom proxy is not running</h2><p>Please start it from <a href=\"/dashboard/token-saver\">Token Saver</a>.</p></body></html>",
        { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    return NextResponse.json({ error: `Headroom proxy is not running: ${error.message}` }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
