import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createProxyPool } from "@/models";

// Relay worker source code deployed to Cloudflare
const RELAY_WORKER_CODE = `
export default {
  async fetch(request, env, ctx) {
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";
    
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      newRequestInit.body = request.body;
      newRequestInit.duplex = "half";
    }

    newRequestInit.headers.delete("x-relay-target");
    newRequestInit.headers.delete("x-relay-path");
    newRequestInit.headers.delete("host");

    try {
      const response = await fetch(targetUrl, newRequestInit);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
`;

interface CloudflareDeployBody {
  accountId?: string;
  apiToken?: string;
  projectName?: string;
}

interface CloudflareErrorResponse {
  errors?: Array<{ message?: string }>;
}

interface CloudflareSubdomainResponse {
  result?: { subdomain?: string };
}

// POST /api/proxy-pools/cloudflare-deploy
export async function POST(request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  try {
    const body = await request.json() as CloudflareDeployBody;
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    const projectName = body.projectName?.trim() || `relay-${Date.now().toString(36)}`;

    if (!accountId || !apiToken) {
      return NextResponse.json({ error: "Cloudflare Account ID and API Token are required" }, { status: 400 });
    }

    // 1. Upload Worker Script
    const workerScriptUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${projectName}`;

    // Cloudflare requires multipart/form-data for worker script upload
    const formData = new FormData();
    formData.append("index.js", new Blob([RELAY_WORKER_CODE], { type: "application/javascript+module" }), "index.js");
    formData.append("metadata", new Blob([JSON.stringify({
      main_module: "index.js",
      compatibility_date: "2024-03-20",
      observability: { enabled: true },
    })], { type: "application/json" }), "metadata.json");

    const uploadRes = await fetch(workerScriptUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({})) as CloudflareErrorResponse;
      console.error("Cloudflare upload error:", err);
      return NextResponse.json(
        { error: err.errors?.[0]?.message ?? "Failed to upload Worker to Cloudflare" },
        { status: uploadRes.status },
      );
    }

    // 2. Enable workers.dev subdomain for the script
    const enableSubdomainRes = await fetch(`${workerScriptUrl}/subdomain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    if (!enableSubdomainRes.ok) {
      const err = await enableSubdomainRes.json().catch(() => ({}));
      console.error("Cloudflare subdomain enable error:", err);
      // Don't fail completely here, just continue
    }

    // 3. Get the workers.dev subdomain for the account to construct the final URL
    let deployUrl = "";
    const subdomainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    });

    if (subdomainRes.ok) {
      const subdomainData = await subdomainRes.json() as CloudflareSubdomainResponse;
      if (subdomainData.result?.subdomain) {
        deployUrl = `https://${projectName}.${subdomainData.result.subdomain}.workers.dev`;
      }
    }

    if (!deployUrl) {
      return NextResponse.json(
        { error: "Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have setup a workers.dev subdomain in Cloudflare Dashboard." },
        { status: 400 },
      );
    }

    // Create proxy pool entry with type cloudflare
    const proxyPool = await createProxyPool({
      name: projectName,
      proxyUrl: deployUrl,
      type: "cloudflare",
      noProxy: "",
      isActive: true,
      strictProxy: false,
    });

    return NextResponse.json({ proxyPool, deployUrl }, { status: 201 });
  } catch (error) {
    console.log("Error deploying Cloudflare relay:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Deploy failed" }, { status: 500 });
  }
}
