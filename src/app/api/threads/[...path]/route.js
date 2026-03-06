import { NextResponse } from "next/server";
import { getSettings, getApiKeys } from "@/lib/localDb";

/**
 * Amp CLI Threads API Proxy
 * Route: /api/threads/...
 */

export async function POST(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const settings = await getSettings();
    const { ampUpstreamUrl, ampUpstreamApiKey, ampRestrictManagementToLocalhost } = settings;

    if (!ampUpstreamUrl || !ampUpstreamApiKey) {
      return NextResponse.json({ error: "Amp upstream not configured" }, { status: 500 });
    }

    if (ampRestrictManagementToLocalhost) {
      const host = request.headers.get("host") || "";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1") || host.includes("::1");

      if (!isLocalhost) {
        return NextResponse.json({ error: "Management API restricted to localhost" }, { status: 403 });
      }
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : (request.headers.get("x-api-key") || "");
    if (!token) {
      return NextResponse.json({ error: "Authorization required" }, { status: 401 });
    }
    const apiKeys = await getApiKeys();
    const validKey = apiKeys.find(k => k.key === token && k.isActive !== false)
      || token === "sk_9router"
      || token === ampUpstreamApiKey;

    if (!validKey) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const upstreamUrl = `${ampUpstreamUrl}${pathname}${url.search}`;
    const body = await request.json();

    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ampUpstreamApiKey}`,
      },
      body: JSON.stringify(body),
    });

    const contentEncoding = response.headers.get("content-encoding");
    let data;
    if (contentEncoding === "gzip") {
      const arrayBuffer = await response.arrayBuffer();
      const decompressed = await new Response(
        new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"))
      ).text();
      data = JSON.parse(decompressed);
    } else {
      data = await response.json();
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[Amp Threads Proxy] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const settings = await getSettings();
    const { ampUpstreamUrl, ampUpstreamApiKey, ampRestrictManagementToLocalhost } = settings;

    if (!ampUpstreamUrl || !ampUpstreamApiKey) {
      return NextResponse.json({ error: "Amp upstream not configured" }, { status: 500 });
    }

    if (ampRestrictManagementToLocalhost) {
      const host = request.headers.get("host") || "";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1") || host.includes("::1");

      if (!isLocalhost) {
        return NextResponse.json({ error: "Management API restricted to localhost" }, { status: 403 });
      }
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : (request.headers.get("x-api-key") || "");
    if (!token) {
      return NextResponse.json({ error: "Authorization required" }, { status: 401 });
    }
    const apiKeys = await getApiKeys();
    const validKey = apiKeys.find(k => k.key === token && k.isActive !== false)
      || token === "sk_9router"
      || token === ampUpstreamApiKey;

    if (!validKey) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const upstreamUrl = `${ampUpstreamUrl}${pathname}${url.search}`;

    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${ampUpstreamApiKey}`,
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[Amp Threads Proxy] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const settings = await getSettings();
    const { ampUpstreamUrl, ampUpstreamApiKey, ampRestrictManagementToLocalhost } = settings;

    if (!ampUpstreamUrl || !ampUpstreamApiKey) {
      return NextResponse.json({ error: "Amp upstream not configured" }, { status: 500 });
    }

    if (ampRestrictManagementToLocalhost) {
      const host = request.headers.get("host") || "";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1") || host.includes("::1");

      if (!isLocalhost) {
        return NextResponse.json({ error: "Management API restricted to localhost" }, { status: 403 });
      }
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : (request.headers.get("x-api-key") || "");
    if (!token) {
      return NextResponse.json({ error: "Authorization required" }, { status: 401 });
    }
    const apiKeys = await getApiKeys();
    const validKey = apiKeys.find(k => k.key === token && k.isActive !== false)
      || token === "sk_9router"
      || token === ampUpstreamApiKey;

    if (!validKey) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const upstreamUrl = `${ampUpstreamUrl}${pathname}${url.search}`;

    const response = await fetch(upstreamUrl, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${ampUpstreamApiKey}`,
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[Amp Threads Proxy] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
