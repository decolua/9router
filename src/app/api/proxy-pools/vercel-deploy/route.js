import { NextResponse } from "next/server";
import { createProxyPool, updateProxyPool, getProxyPoolById } from "@/models";

const VERCEL_API = "https://api.vercel.com";

// Relay function source code deployed to Vercel
// Forwards requests to target URL specified in x-relay-target header
const RELAY_FUNCTION_CODE = `
export const maxDuration = 300;
export const config = { runtime: "edge" };

export default async function handler(req) {
  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;

  const headers = new Headers(req.headers);
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    duplex: "half",
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
`;

async function pollDeployment(deploymentId, token, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.readyState === "READY") return data;
    if (data.readyState === "ERROR" || data.readyState === "CANCELED") {
      throw new Error(`Deployment failed: ${data.readyState}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Deployment timed out");
}

// POST /api/proxy-pools/vercel-deploy
export async function POST(request) {
  try {
    const body = await request.json();
    const vercelToken = body.vercelToken;
    const projectName = body.projectName?.trim() || `relay-${Date.now().toString(36)}`;

    if (!vercelToken) {
      return NextResponse.json({ error: "Vercel API token is required" }, { status: 400 });
    }

    // Deploy relay function to Vercel
    const deployRes = await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        files: [
          {
            file: "api/relay.js",
            data: RELAY_FUNCTION_CODE,
          },
          {
            file: "package.json",
            data: JSON.stringify({ name: projectName, version: "1.0.0" }),
          },
          {
            file: "vercel.json",
            data: JSON.stringify({
              rewrites: [{ source: "/(.*)", destination: "/api/relay" }],
              functions: {
                "api/*.js": {
                  maxDuration: 300
                }
              }
            }),
          },
        ],
        projectSettings: {
          framework: null,
        },
        target: "production",
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || "Failed to create Vercel deployment" },
        { status: deployRes.status }
      );
    }

    const deployment = await deployRes.json();
    const deploymentId = deployment.id || deployment.uid;

    // Disable deployment protection (Vercel Authentication)
    const projectId = deployment.projectId || projectName;
    await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    });

    // Poll until deployment is ready
    const ready = await pollDeployment(deploymentId, vercelToken);
    const deployUrl = `https://${ready.url}`;

    // Create proxy pool entry with type vercel
    const proxyPool = await createProxyPool({
      name: projectName,
      proxyUrl: deployUrl,
      type: "vercel",
      noProxy: "",
      isActive: true,
      strictProxy: false,
    });

    return NextResponse.json({ proxyPool, deployUrl }, { status: 201 });
  } catch (error) {
    console.log("Error deploying Vercel relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}

// PUT /api/proxy-pools/vercel-deploy?poolId=<id>
export async function PUT(request) {
  try {
    const { searchParams } = new URL(request.url);
    const poolId = searchParams.get("poolId");

    if (!poolId) {
      return NextResponse.json({ error: "poolId is required" }, { status: 400 });
    }

    const pool = await getProxyPoolById(poolId);
    if (!pool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    if (pool.type !== "vercel") {
      return NextResponse.json({ error: "Only Vercel relay pools can be redeployed" }, { status: 400 });
    }

    const body = await request.json();
    const vercelToken = body.vercelToken;

    if (!vercelToken) {
      return NextResponse.json({ error: "Vercel API token is required" }, { status: 400 });
    }

    // Extract project name from existing proxyUrl (e.g., "https://my-relay.vercel.app" -> "my-relay")
    let projectName;
    try {
      const url = new URL(pool.proxyUrl);
      projectName = url.hostname.split(".")[0];
    } catch {
      return NextResponse.json({ error: "Invalid proxy URL in pool" }, { status: 400 });
    }

    // Deploy new version to Vercel
    const deployRes = await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        files: [
          {
            file: "api/relay.js",
            data: RELAY_FUNCTION_CODE,
          },
          {
            file: "package.json",
            data: JSON.stringify({ name: projectName, version: "1.0.0" }),
          },
          {
            file: "vercel.json",
            data: JSON.stringify({
              rewrites: [{ source: "/(.*)", destination: "/api/relay" }],
              functions: {
                "api/*.js": {
                  maxDuration: 300
                }
              }
            }),
          },
        ],
        projectSettings: {
          framework: null,
        },
        target: "production",
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || "Failed to redeploy" },
        { status: deployRes.status }
      );
    }

    const deployment = await deployRes.json();
    const deploymentId = deployment.id || deployment.uid;

    // Disable deployment protection (Vercel Authentication)
    const projectId = deployment.projectId || projectName;
    await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    });

    // Poll until deployment is ready
    const ready = await pollDeployment(deploymentId, vercelToken);
    const deployUrl = `https://${ready.url}`;

    // Update pool with new URL
    const updatedPool = await updateProxyPool(poolId, {
      proxyUrl: deployUrl,
      isActive: true,
    });

    return NextResponse.json({ proxyPool: updatedPool, deployUrl });
  } catch (error) {
    console.log("Error redeploying Vercel relay:", error);
    return NextResponse.json({ error: error.message || "Redeploy failed" }, { status: 500 });
  }
}
