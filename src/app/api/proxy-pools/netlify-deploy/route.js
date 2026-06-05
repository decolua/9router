import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

const RELAY_FUNCTION_CODE = `exports.handler = async (event) => {
  const target = event.headers["x-relay-target"];
  const relayPath = event.headers["x-relay-path"] || "/";
  if (!target) {
    return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Missing x-relay-target header" }) };
  }
  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const headers = { ...event.headers };
  delete headers["x-relay-target"]; delete headers["x-relay-path"]; delete headers["host"];
  const init = { method: event.httpMethod, headers };
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD" && event.body) {
    init.body = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  }
  try {
    const resp = await fetch(targetUrl, init);
    const buf = Buffer.from(await resp.arrayBuffer());
    return { statusCode: resp.status, headers: { "content-type": resp.headers.get("content-type") || "application/octet-stream" }, body: buf.toString("base64"), isBase64Encoded: true };
  } catch (e) {
    return { statusCode: 502, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
};`;

const NETLIFY_TOML = `[build]
  functions = "functions"
  publish = "."

[[redirects]]
  from = "/*"
  to = "/.netlify/functions/relay"
  status = 200
  force = true
`;

const INDEX_HTML = `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f8fafc"><div style="text-align:center;border:1px solid rgba(255,255,255,.1);padding:2.5rem;border-radius:12px;background:rgba(255,255,255,.02);max-width:400px"><h1 style="color:#06b6d4;margin:0 0 1rem 0;font-size:1.75rem">9router Netlify Relay</h1><p style="margin:0;color:#94a3b8;font-size:.95rem;line-height:1.5">Your Netlify relay is active. Target requests are routed programmatically.</p></div></body></html>`;

async function runNetlifyDeploy(siteId, netlifyToken, projectDir) {
  // Token is passed via env only (NETLIFY_AUTH_TOKEN) — never on argv — so it
  // does not leak to the process list and cannot break argument parsing.
  // execFile with an arg array avoids shell interpolation entirely.
  const args = [
    "-y", "netlify-cli@17", "deploy",
    "--prod", "--dir", ".", "--functions", "functions",
    "--site", siteId, "--json",
  ];
  const { stdout, stderr } = await execFileAsync("npx", args, {
    cwd: projectDir,
    env: { ...process.env, NETLIFY_AUTH_TOKEN: netlifyToken },
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stderr && stderr.includes("JSONHTTPError")) {
    throw new Error(stderr.trim().split("\n").pop() || "Netlify CLI error");
  }
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("Netlify CLI did not return JSON output");
  }
  const json = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
  return { deployUrl: json.deploy_url || json.url, deployId: json.deploy_id };
}

async function verifyRelayIsActive(deployUrl) {
  const res = await fetch(deployUrl, { method: "GET" });
  const ct = res.headers?.get?.("content-type") || "";
  if (res.status !== 400 || !ct.includes("application/json")) {
    throw new Error(`Netlify relay verification failed (${res.status}). Function did not handle the request.`);
  }
  const body = await res.json().catch(() => null);
  if (body?.error !== "Missing x-relay-target header") {
    throw new Error("Netlify relay verification failed. Unexpected response.");
  }
}

export async function POST(request) {
  let projectDir = null;
  try {
    const body = await request.json();
    const netlifyToken = body.netlifyToken?.trim();
    const projectName = body.projectName?.trim();
    if (!netlifyToken) return NextResponse.json({ error: "Netlify API token is required" }, { status: 400 });

    // 1. Create site
    const siteRes = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST", headers: { Authorization: `Bearer ${netlifyToken}`, "Content-Type": "application/json" }, body: JSON.stringify(projectName ? { name: projectName } : {}),
    });
    if (!siteRes.ok) {
      const err = await siteRes.json().catch(() => ({}));
      return NextResponse.json({ error: err.message || "Failed to create Netlify site" }, { status: siteRes.status });
    }
    const site = await siteRes.json();
    const siteId = site.id;
    const finalName = site.name;
    const deployUrl = site.ssl_url || site.url;

    // 2. Create temp project with serverless function
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "9router-netlify-"));
    await fs.writeFile(path.join(projectDir, "index.html"), INDEX_HTML);
    await fs.writeFile(path.join(projectDir, "netlify.toml"), NETLIFY_TOML);
    await fs.mkdir(path.join(projectDir, "functions"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "functions", "relay.js"), RELAY_FUNCTION_CODE);

    // 3. Deploy via CLI
    let deployInfo;
    try {
      deployInfo = await runNetlifyDeploy(siteId, netlifyToken, projectDir);
    } catch (cliErr) {
      await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${netlifyToken}` } }).catch(() => {});
      return NextResponse.json({ error: cliErr.message || "Netlify CLI deploy failed" }, { status: 502 });
    }

    // 4. Verify live relay
    try {
      await verifyRelayIsActive(deployUrl);
    } catch (verifyErr) {
      await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${netlifyToken}` } }).catch(() => {});
      return NextResponse.json({ error: verifyErr.message || "Netlify relay verification failed" }, { status: 502 });
    }

    // 5. Persist proxy pool
    const proxyPool = await createProxyPool({
      name: finalName, proxyUrl: deployUrl, type: "netlify", noProxy: "", isActive: true, strictProxy: false,
    });

    return NextResponse.json({ proxyPool, deployUrl }, { status: 201 });
  } catch (error) {
    console.log("Error deploying Netlify relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  } finally {
    if (projectDir) await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
}
