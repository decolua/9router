import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { fetchHeadroom, validateHeadroomUrl } from "@/lib/headroom/transport";
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

async function getTargetBase() {
  const settings = await getSettings();
  const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
  return validateHeadroomUrl(url);
}

function buildTargetUrl(base, path, search) {
  const target = new URL(base);
  target.pathname = target.pathname.replace(/\/$/, "") + "/" + path.join("/");
  target.search = search;
  return target;
}

function forwardedHeaders(request) {
  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.delete("host");
  // Even a proxy bound to loopback can belong to another service.
  for (const name of ["cookie", "authorization", "x-api-key", "x-9r-cli-token", "x-9r-peer-token"]) headers.delete(name);
  return headers;
}

function rewriteDashboardHtml(html) {
  return html.replace(
    /fetch\('(?=\/(?:stats|health|stats-history|transformations\/feed))/g,
    `fetch('${DASHBOARD_PREFIX}`,
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

    const response = await fetchHeadroom(target, {
      method,
      headers: forwardedHeaders(request),
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
    });

    const headers = new Headers(response.headers);
    headers.delete("set-cookie");
    for (const header of HOP_BY_HOP_HEADERS) {
      headers.delete(header);
    }

    if (path.join("/") === "dashboard") {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        headers.delete("content-length");
        return new NextResponse(rewriteDashboardHtml(await response.text()), {
          status: response.status,
          headers,
        });
      }
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
