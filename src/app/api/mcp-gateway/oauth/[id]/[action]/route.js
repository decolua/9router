// MCP gateway OAuth flow: authorize + callback + status.
//
//   GET  /api/mcp-gateway/oauth/[id]/authorize
//     1. Look up the instance. If `oauthTokens.client` is missing, try
//        dynamic client registration against the upstream's AS.
//     2. Generate PKCE (code_verifier, code_challenge, state).
//     3. Build the authorization URL with `resource=<instanceUrl>`
//        (RFC 8707 — required by MCP).
//     4. Persist the pending exchange in a server-side session store
//        (in-memory, scoped to instanceId+state).
//     5. Return { url, state } — the dashboard opens `url` in a new tab.
//
//   GET  /api/mcp-gateway/oauth/[id]/callback?code=...&state=...
//     1. Validate `state` against the session store (CSRF).
//     2. POST the token exchange (code + verifier + client_id + resource).
//     3. Persist tokens on the instance row via `storeTokens`.
//     4. Render a small "success" page that auto-closes.
//
//   GET  /api/mcp-gateway/oauth/[id]/status?state=...
//     Dashboard polls this to know when the flow completed.

import { NextResponse } from "next/server";
import { getInstanceById, updateInstance } from "@/lib/localDb";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import {
  registerMcpSession,
  getMcpSessionStatus,
  completeMcpSession,
  clearMcpSession,
} from "@/lib/oauth/utils/server";
import { discoverAuth } from "@/lib/mcp/gateway/oauthDiscovery";
import { registerClient } from "@/lib/mcp/gateway/oauthRegister";
import { storeTokens } from "@/lib/mcp/gateway/oauthRefresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CALLBACK_TIMEOUT_MS = 300_000;

function appBase(request) {
  // Trust the inbound Host; the callback lands on the same app.
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get("x-forwarded-host") || url.host}`;
}

function buildAuthorizeUrl(opts) {
  const u = new URL(opts.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", opts.state);
  if (opts.resource) u.searchParams.set("resource", opts.resource);
  if (opts.scope) u.searchParams.set("scope", opts.scope);
  return u.toString();
}

async function ensureClient(instance, request) {
  if (instance.oauthTokens?.client?.clientId) {
    return {
      clientId: instance.oauthTokens.client.clientId,
      // Preserve || semantics: empty string becomes null (same as original JS)
      clientSecret: instance.oauthTokens.client.clientSecret || null,
    };
  }
  // Try discovery + dynamic registration.
  const meta = await discoverAuth(instance.url, { wwwAuthenticate: instance.oauthTokens?._lastChallenge });
  if (!meta?.registration_endpoint) {
    throw new Error("no client_id configured and AS has no registration_endpoint — set client_id manually in the instance form");
  }
  const redirectUri = `${appBase(request)}/api/mcp-gateway/oauth/${instance.id}/callback`;
  const reg = await registerClient(meta.registration_endpoint, redirectUri);
  // Persist client + as metadata so subsequent refreshes have what they need.
  const newTokens = {
    resource: meta.resource,
    scope: instance.oauthTokens?.scope,
    _lastChallenge: instance.oauthTokens?._lastChallenge,
    client: {
      clientId: reg.clientId,
      clientSecret: reg.clientSecret,
      clientIdIssuedAt: reg.clientIdIssuedAt,
    },
    as: {
      token_endpoint: meta.token_endpoint,
      authorization_endpoint: meta.authorization_endpoint,
      registration_endpoint: meta.registration_endpoint,
    },
  };
  await updateInstance(instance.id, { oauthTokens: newTokens });
  return { clientId: reg.clientId, clientSecret: reg.clientSecret };
}

function toOauthInstance(raw) {
  const oauthTokens = raw["oauthTokens"];
  return {
    id: raw.id,
    url: typeof raw["url"] === "string" ? raw["url"] : undefined,
    oauthTokens: oauthTokens && typeof oauthTokens === "object" && !Array.isArray(oauthTokens)
      ? oauthTokens
      : undefined,
  };
}

export async function GET(request, context) {
  const { id, action } = await context.params;
  const url = new URL(request.url);

  if (action === "authorize") {
    const raw = await getInstanceById(id);
    if (!raw) return NextResponse.json({ error: "instance not found" }, { status: 404 });
    const instance = toOauthInstance(raw);
    if (!instance.url) return NextResponse.json({ error: "instance has no url" }, { status: 400 });
    let client;
    try {
      client = await ensureClient(instance, request);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const rawAs1 = instance.oauthTokens?.as;
    const meta = {
      token_endpoint: rawAs1?.token_endpoint,
      authorization_endpoint: rawAs1?.authorization_endpoint,
      registration_endpoint: rawAs1?.registration_endpoint,
      resource: instance.oauthTokens?.resource,
    };
    if (!meta.authorization_endpoint) {
      // Fall back to discovery if registration succeeded but we didn't capture AS.
      const discovered = await discoverAuth(instance.url, { wwwAuthenticate: instance.oauthTokens?._lastChallenge });
      if (!discovered?.authorization_endpoint) {
        return NextResponse.json({ error: "no authorization_endpoint available" }, { status: 400 });
      }
      meta.authorization_endpoint = discovered.authorization_endpoint;
      // Preserve || semantics from original
      meta.token_endpoint = meta.token_endpoint || discovered.token_endpoint;
    }
    const pkce = generatePKCE();
    const redirectUri = `${appBase(request)}/api/mcp-gateway/oauth/${instance.id}/callback`;
    const authUrl = buildAuthorizeUrl({
      authorizationEndpoint: meta.authorization_endpoint,
      clientId: client.clientId,
      redirectUri,
      codeChallenge: pkce.codeChallenge,
      state: pkce.state,
      // Preserve || semantics from original
      resource: instance.oauthTokens?.resource || instance.url,
      scope: instance.oauthTokens?.scope,
    });
    registerMcpSession({
      instanceId: instance.id,
      state: pkce.state,
      codeVerifier: pkce.codeVerifier,
      redirectUri,
      // Preserve || semantics from original
      resource: instance.oauthTokens?.resource || instance.url,
      clientId: client.clientId,
    });
    return NextResponse.json({ url: authUrl, state: pkce.state, expiresInMs: CALLBACK_TIMEOUT_MS });
  }

  if (action === "callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");
    if (errParam) {
      return new Response(renderResultPage(false, `OAuth error: ${errParam}`), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (!code || !state) {
      return new Response(renderResultPage(false, "missing code or state"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const raw = await getInstanceById(id);
    if (!raw) return NextResponse.json({ error: "instance not found" }, { status: 404 });
    const instance = toOauthInstance(raw);
    const session = getMcpSessionStatus(id, state);
    if (!session) {
      return new Response(renderResultPage(false, "CSRF check failed (no session)"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const rawAs2 = instance.oauthTokens?.as;
    const meta = {
      token_endpoint: rawAs2?.token_endpoint,
      authorization_endpoint: rawAs2?.authorization_endpoint,
      registration_endpoint: rawAs2?.registration_endpoint,
      resource: instance.oauthTokens?.resource,
    };
    const tokenEndpoint = meta.token_endpoint;
    if (!tokenEndpoint) {
      completeMcpSession(id, state, { status: "error", error: "no token_endpoint stored" });
      return new Response(renderResultPage(false, "no token_endpoint on instance"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    // Exchange code → tokens
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: session.codeVerifier,
      client_id: session.clientId,
      redirect_uri: session.redirectUri,
    });
    if (session.resource) body.set("resource", session.resource);
    try {
      const tokenRes = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
      });
      const text = await tokenRes.text();
      if (!tokenRes.ok) {
        completeMcpSession(id, state, { status: "error", error: `token ${tokenRes.status}: ${text?.slice(0, 200)}` });
        return new Response(renderResultPage(false, `token exchange failed: ${tokenRes.status}`), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      const doc = JSON.parse(text);
      if (!doc.access_token) {
        completeMcpSession(id, state, { status: "error", error: "no access_token in response" });
        return new Response(renderResultPage(false, "no access_token in response"), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      await storeTokens(id, {
        access_token: doc.access_token,
        refresh_token: doc.refresh_token || undefined,
        token_type: doc.token_type || "Bearer",
        scope: doc.scope || session.scope,
        expires_at: doc.expires_in ? Date.now() + Number(doc.expires_in) * 1000 : undefined,
        token_endpoint: tokenEndpoint,
        client: instance.oauthTokens?.client
          ? { clientId: instance.oauthTokens.client.clientId, clientSecret: instance.oauthTokens.client.clientSecret || undefined }
          : undefined,
        as: { token_endpoint: meta.token_endpoint },
        resource: session.resource,
        needsReauth: false,
      });
      completeMcpSession(id, state, { status: "complete", tokens: { hasAccess: true } });
      return new Response(renderResultPage(true, "Connected. You can close this tab."), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      completeMcpSession(id, state, { status: "error", error: msg });
      return new Response(renderResultPage(false, `exchange error: ${msg}`), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } finally {
      // Keep the session around briefly so the dashboard can poll status.
      setTimeout(() => clearMcpSession(id, state), 30_000);
    }
  }

  if (action === "status") {
    const state = url.searchParams.get("state");
    if (!state) return NextResponse.json({ error: "missing state" }, { status: 400 });
    const session = getMcpSessionStatus(id, state);
    if (!session) return NextResponse.json({ status: "missing" });
    return NextResponse.json({
      status: session.status,
      error: session.error || null,
    });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 404 });
}

function renderResultPage(success, message) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${message}</p><p>You can close this tab and return to 9Router.</p>
</div></body></html>`;
}
