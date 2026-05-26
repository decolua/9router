import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import crypto from "crypto";

const NETLIFY_API = "https://api.netlify.com/api/v1";

const RELAY_FUNCTION_CODE = `export default async (request, context) => {
  const target = request.headers.get("x-relay-target");
  const relayPath = request.headers.get("x-relay-path") || "/";

  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const newHeaders = new Headers(request.headers);
  newHeaders.delete("x-relay-target");
  newHeaders.delete("x-relay-path");
  newHeaders.delete("host");

  const init = {
    method: request.method,
    headers: newHeaders,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl, init);
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
};

export const config = {
  path: "/*",
};
`;

const INDEX_HTML_CODE = `<!DOCTYPE html>
<html>
<head>
  <title>9router Netlify Relay</title>
</head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
  <div style="text-align: center; border: 1px solid rgba(255,255,255,0.1); padding: 2.5rem; border-radius: 12px; background: rgba(255,255,255,0.02); max-width: 400px; width: 100%;">
    <h1 style="color: #06b6d4; margin: 0 0 1rem 0; font-size: 1.75rem;">9router Netlify Relay</h1>
    <p style="margin: 0; color: #94a3b8; font-size: 0.95rem; line-height: 1.5;">Your Netlify Edge Relay is successfully deployed and active. Target requests will be routed programmatically.</p>
  </div>
</body>
</html>
`;

function sha1(content) {
  return crypto.createHash("sha1").update(content).digest("hex");
}

async function pollDeployment(deployId, token, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${NETLIFY_API}/deploys/${deployId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to check deploy status (${res.status})`);
    }
    const data = await res.json();
    if (data.state === "ready") return data;
    if (data.state === "error") {
      throw new Error(`Deployment failed in Netlify: ${data.error_message || "unknown error"}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Deployment timed out");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const netlifyToken = body.netlifyToken?.trim();
    const projectName = body.projectName?.trim();

    if (!netlifyToken) {
      return NextResponse.json({ error: "Netlify API token is required" }, { status: 400 });
    }

    // 1. Create a site on Netlify
    const sitePayload = {};
    if (projectName) {
      sitePayload.name = projectName;
    }

    const createSiteRes = await fetch(`${NETLIFY_API}/sites`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${netlifyToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sitePayload),
    });

    if (!createSiteRes.ok) {
      const err = await createSiteRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.message || "Failed to create Netlify site. Ensure the site name is unique and token is valid." },
        { status: createSiteRes.status }
      );
    }

    const site = await createSiteRes.json();
    const siteId = site.id;
    const finalProjectName = site.name;
    const deployUrl = site.ssl_url || site.url;

    // 2. Prepare file digests
    const indexSha = sha1(INDEX_HTML_CODE);
    const relaySha = sha1(RELAY_FUNCTION_CODE);

    const deployPayload = {
      files: {
        "index.html": indexSha,
        "netlify/edge-functions/relay.js": relaySha,
      },
    };

    // 3. Initiate the deploy
    const initDeployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${netlifyToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deployPayload),
    });

    if (!initDeployRes.ok) {
      const err = await initDeployRes.json().catch(() => ({}));
      // Clean up created site if deployment init fails
      await fetch(`${NETLIFY_API}/sites/${siteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${netlifyToken}` },
      }).catch(() => {});

      return NextResponse.json(
        { error: err.message || "Failed to initiate Netlify deployment" },
        { status: initDeployRes.status }
      );
    }

    const deployData = await initDeployRes.json();
    const deployId = deployData.id;
    const requiredFiles = deployData.required || [];

    // 4. Upload files that Netlify requests
    const fileMap = {
      [indexSha]: { path: "index.html", content: INDEX_HTML_CODE },
      [relaySha]: { path: "netlify/edge-functions/relay.js", content: RELAY_FUNCTION_CODE },
    };

    for (const sha of requiredFiles) {
      const file = fileMap[sha];
      if (!file) continue;

      const uploadRes = await fetch(`${NETLIFY_API}/deploys/${deployId}/files/${encodeURIComponent(file.path)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${netlifyToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: file.content,
      });

      if (!uploadRes.ok) {
        // Clean up created site if upload fails
        await fetch(`${NETLIFY_API}/sites/${siteId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${netlifyToken}` },
        }).catch(() => {});

        return NextResponse.json(
          { error: `Failed to upload file ${file.path}` },
          { status: uploadRes.status }
        );
      }
    }

    // 5. Poll deploy status until ready
    await pollDeployment(deployId, netlifyToken);

    // 6. Create proxy pool entry in local database
    const proxyPool = await createProxyPool({
      name: finalProjectName,
      proxyUrl: deployUrl,
      type: "netlify",
      noProxy: "",
      isActive: true,
      strictProxy: false,
    });

    return NextResponse.json({ proxyPool, deployUrl }, { status: 201 });
  } catch (error) {
    console.log("Error deploying Netlify relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}
