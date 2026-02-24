import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { getProxyAgent, clearProxyCache } from "open-sse/utils/proxy-agent-factory.js";
import { PROVIDERS } from "open-sse/config/constants.js";

/**
 * POST /api/providers/[id]/proxy/test - Test proxy connectivity
 *
 * Tests proxy by connecting to:
 * 1. Provider's own API endpoint (most reliable)
 * 2. Fallback to common public endpoints
 */
export async function POST(request, { params }) {
  try {
    const connection = await getProviderConnectionById(params.id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const proxyConfig = connection.proxy;

    if (!proxyConfig?.url) {
      return NextResponse.json({ error: "No proxy configured" }, { status: 400 });
    }

    // Build test targets: provider API first, then fallback endpoints
    const providerConfig = PROVIDERS[connection.provider];
    const testTargets = [];

    // Add provider's own API endpoint if available
    if (providerConfig?.baseUrl) {
      testTargets.push({ url: providerConfig.baseUrl, name: "Provider API" });
    }

    // Add fallback endpoints
    testTargets.push(
      { url: "https://www.cloudflare.com", name: "Cloudflare" },
      { url: "https://api.github.com", name: "GitHub API" },
      { url: "https://www.google.com", name: "Google" }
    );

    let lastError = null;
    let workingTarget = null;

    // Clear cache to ensure fresh connection
    clearProxyCache();

    for (const target of testTargets) {
      try {
        const agent = await getProxyAgent(proxyConfig.url);

        const fetchOptions = {
          method: "HEAD",
          dispatcher: agent,
          signal: AbortSignal.timeout(10000), // 10s timeout
        };

        const response = await fetch(target.url, fetchOptions);

        if (response.ok || response.status < 500) {
          // Accept any non-5xx response (4xx means proxy works, just endpoint logic)
          workingTarget = target.name;
          break;
        }
      } catch (error) {
        lastError = error.message;
        continue;
      }
    }

    if (workingTarget) {
      return NextResponse.json({
        success: true,
        message: `Proxy is working (tested via ${workingTarget})`,
      });
    }

    return NextResponse.json(
      {
        error: "Proxy test failed",
        details: lastError || "Could not connect through proxy",
        note: "Try checking proxy URL, credentials, and network connectivity",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error testing proxy:", error);
    return NextResponse.json(
      { error: error.message || "Failed to test proxy" },
      { status: 500 }
    );
  }
}
