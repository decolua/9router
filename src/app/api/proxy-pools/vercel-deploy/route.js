import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";

const VERCEL_API = "https://api.vercel.com";

// Relay function source code deployed to Vercel
// Forwards requests to target URL specified in x-relay-target header
const RELAY_FUNCTION_CODE = `
export const config = { runtime: "edge" };

function normalizeHost(hostname) {
  return String(hostname || "").replace(/^\\[|\\]$/g, "").replace(/\\.$/, "").toLowerCase();
}

function isPrivateHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") return true;

  const v4 = host.split(".").map((p) => /^\\d+$/.test(p) ? Number(p) : -1);
  if (v4.length === 4 && v4.every((n) => n >= 0 && n <= 255)) {
    if (v4[0] === 0 || v4[0] === 10 || v4[0] === 127) return true;
    if (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127) return true;
    if (v4[0] === 169 && v4[1] === 254) return true;
    if (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) return true;
    if (v4[0] === 192 && v4[1] === 168) return true;
    if (v4[0] === 192 && v4[1] === 0 && (v4[2] === 0 || v4[2] === 2)) return true;
    if (v4[0] === 198 && (v4[1] === 18 || v4[1] === 19 || (v4[1] === 51 && v4[2] === 100))) return true;
    if (v4[0] === 203 && v4[1] === 0 && v4[2] === 113) return true;
    if (v4[0] >= 224) return true;
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb") || host.startsWith("ff")) return true;
    if (host.startsWith("2001:db8") || host.startsWith("2002:")) return true;
  }

  return false;
}

function assertRelayTarget(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Bad scheme");
  if (isPrivateHost(parsed.hostname)) throw new Error("Private targets are blocked");
  return parsed;
}

export default async function handler(req) {
  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let targetUrl;
  try {
    targetUrl = assertRelayTarget(target.replace(/\\/$/, "") + relayPath).toString();
  } catch {
    return new Response(JSON.stringify({ error: "Blocked relay target" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const headers = new Headers(req.headers);
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    duplex: "half",
    redirect: "manual",
  });

  const location = response.headers.get("location");
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    try {
      assertRelayTarget(new URL(location, targetUrl).toString());
    } catch {
      return new Response(JSON.stringify({ error: "Blocked relay redirect" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  }

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
