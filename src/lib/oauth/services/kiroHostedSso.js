import http from "http";
import { URL } from "url";
import { KIRO_EXTERNAL_IDP_DEFAULTS, assertValidAwsRegion } from "../constants/oauth.js";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "../utils/pkce.js";
import { KiroService } from "./kiro.js";

const EXTERNAL_IDP_KIND = "external_idp";
const SOCIAL_KIND = "social";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeLoopbackHost(host) {
  return String(host || "").trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function assertLoopbackHost(host, label) {
  if (!LOOPBACK_HOSTS.has(normalizeLoopbackHost(host))) {
    throw new Error(`${label} must be a loopback host`);
  }
}

function validatePastedCallbackUrl(parsed) {
  if (parsed.protocol !== "http:") {
    throw new Error("Callback URL must use http");
  }
  assertLoopbackHost(parsed.hostname, "Callback URL host");
  if (parsed.port !== String(KIRO_EXTERNAL_IDP_DEFAULTS.loopbackPort)) {
    throw new Error(`Callback URL must use port ${KIRO_EXTERNAL_IDP_DEFAULTS.loopbackPort}`);
  }
  const allowedPaths = new Set([
    "/",
    KIRO_EXTERNAL_IDP_DEFAULTS.oauthCallbackPath,
    KIRO_EXTERNAL_IDP_DEFAULTS.portalCallbackPath,
  ]);
  if (!allowedPaths.has(parsed.pathname)) {
    throw new Error("Callback URL path does not match this Kiro sign-in flow");
  }
  if (parsed.toString().length > KIRO_EXTERNAL_IDP_DEFAULTS.maxCallbackUrlLength) {
    throw new Error("Callback URL is too long");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function writeCallbackPage(res, ok) {
  const title = ok ? "Kiro sign-in complete" : "Kiro sign-in failed";
  const message = ok
    ? "Kiro sign-in complete. You can close this tab and return to 9router."
    : "Kiro sign-in failed. Return to 9router and try again.";
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;max-width:42rem;margin:auto">` +
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`
  );
}

function deliverOnce(session, capture) {
  if (session.done) return;
  session.done = true;
  cleanupSession(session);
  session.resolve(capture);
}

function rejectOnce(session, error) {
  if (session.done) return;
  session.done = true;
  cleanupSession(session);
  session.reject(error instanceof Error ? error : new Error(String(error)));
}

function cleanupSession(session) {
  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }
  if (session.server) {
    try { session.server.close(); } catch {}
    session.server = null;
  }
}

function callbackBaseUrl() {
  const host = process.env.KIRO_SSO_CALLBACK_HOST || KIRO_EXTERNAL_IDP_DEFAULTS.callbackHost;
  assertLoopbackHost(host, "Kiro SSO callback host");
  return `http://${host}:${KIRO_EXTERNAL_IDP_DEFAULTS.loopbackPort}`;
}

function callbackBindHost() {
  const host = process.env.KIRO_SSO_CALLBACK_BIND || KIRO_EXTERNAL_IDP_DEFAULTS.loopbackHost;
  assertLoopbackHost(host, "Kiro SSO callback bind host");
  return host;
}

export function buildKiroHostedSsoUrl({ codeChallenge, state }) {
  const redirectUri = callbackBaseUrl();
  const url = new URL(KIRO_EXTERNAL_IDP_DEFAULTS.signInBaseUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("redirect_from", KIRO_EXTERNAL_IDP_DEFAULTS.redirectFrom);
  return url.toString();
}

export function validateExternalIdpEndpoint(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch (err) {
    throw new Error(`Invalid external IdP URL: ${err.message}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("External IdP URL must be https");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new Error("External IdP URL has no host");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    throw new Error("External IdP host must not be an IP literal");
  }
  const isAllowed = KIRO_EXTERNAL_IDP_DEFAULTS.allowedIssuerSuffixes.some((suffix) => host.endsWith(suffix));
  if (!isAllowed) {
    throw new Error(`External IdP host ${host} is not allow-listed`);
  }
}

export async function discoverExternalIdpEndpoints(issuerUrl) {
  validateExternalIdpEndpoint(issuerUrl);
  const docUrl = `${String(issuerUrl).replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(docUrl, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`OIDC discovery failed (status ${response.status})`);
  }
  const doc = await response.json();
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error("OIDC discovery document missing authorization_endpoint or token_endpoint");
  }
  validateExternalIdpEndpoint(doc.authorization_endpoint);
  validateExternalIdpEndpoint(doc.token_endpoint);
  return {
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
  };
}

export function buildExternalIdpAuthorizeUrl({ authorizationEndpoint, clientId, redirectUri, scopes, codeChallenge, state, loginHint }) {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes || "");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export function startKiroHostedSsoSession({ region = "us-east-1" } = {}) {
  assertValidAwsRegion(region);

  const verifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(verifier);
  const state = generateState();
  const signInUrl = buildKiroHostedSsoUrl({ codeChallenge, state });
  const redirectUri = callbackBaseUrl();
  const oauthCallbackUri = `${redirectUri}${KIRO_EXTERNAL_IDP_DEFAULTS.oauthCallbackPath}`;

  const session = {
    verifier,
    state,
    region,
    redirectUri,
    oauthCallbackUri,
    phase: "portal",
    leg2: null,
    done: false,
    server: null,
    timeoutHandle: null,
    portInUse: false,
    promise: null,
    resolve: null,
    reject: null,
  };

  session.promise = new Promise((resolve, reject) => {
    session.resolve = resolve;
    session.reject = reject;
  });

  session.server = http.createServer((req, res) => {
    handleKiroHostedCallback(session, req, res).catch((error) => {
      writeCallbackPage(res, false);
      rejectOnce(session, error);
    });
  });

  session.timeoutHandle = setTimeout(() => {
    rejectOnce(session, new Error("Kiro SSO login timed out"));
  }, KIRO_EXTERNAL_IDP_DEFAULTS.loopbackTimeoutMs);

  // If the loopback port is already bound (Kiro IDE running, container, etc.),
  // do NOT fail the whole flow — the user can still complete it by pasting the
  // callback URL manually. Only non-EADDRINUSE errors are terminal.
  session.server.once("error", (error) => {
    if (error && (error.code === "EADDRINUSE" || /EADDRINUSE/.test(String(error.message)))) {
      session.portInUse = true;
      session.server = null;
      return;
    }
    rejectOnce(session, error);
  });

  session.server.listen(
    KIRO_EXTERNAL_IDP_DEFAULTS.loopbackPort,
    callbackBindHost()
  );

  return {
    session,
    signInUrl,
    state,
    redirectUri,
  };
}

export function cancelKiroHostedSsoSession(session) {
  if (!session) return;
  rejectOnce(session, new Error("Kiro SSO login cancelled"));
}

export async function submitKiroHostedSsoCallback(session, callbackUrl) {
  if (!session) throw new Error("No active Kiro SSO session");
  let parsed;
  try {
    parsed = new URL(String(callbackUrl || "").trim());
  } catch (error) {
    throw new Error(`Invalid callback URL: ${error.message}`);
  }
  validatePastedCallbackUrl(parsed);
  return processKiroHostedCallback(session, parsed, { trusted: false });
}

async function handleKiroHostedCallback(session, req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const result = await processKiroHostedCallback(session, reqUrl);
  if (result.action === "redirect") {
    res.statusCode = 302;
    res.setHeader("Location", result.location);
    res.end();
    return;
  }
  if (result.action === "success") {
    writeCallbackPage(res, true);
    return;
  }
  if (result.action === "failure") {
    writeCallbackPage(res, false);
    return;
  }
  res.statusCode = 204;
  res.end();
}

async function processKiroHostedCallback(session, reqUrl, { trusted = true } = {}) {
  const q = reqUrl.searchParams;

  const hasExternalDescriptor =
    reqUrl.pathname !== KIRO_EXTERNAL_IDP_DEFAULTS.oauthCallbackPath &&
    (q.get("login_option")?.trim().toLowerCase() === EXTERNAL_IDP_KIND || q.get("issuer_url")?.trim());

  if (hasExternalDescriptor) {
    if (session.phase !== "portal" || session.leg2) return { action: "ignored" };

    // For pasted URLs (VPS deployment), state is whatever the upstream IdP put
    // on the URL. CSRF protection comes from the sessionId in the body, not the
    // URL state — so we only require a matching state when the request came
    // directly to our loopback listener (trusted path).
    if (trusted) {
      const portalState = q.get("state")?.trim();
      if (!portalState || portalState !== session.state) return { action: "ignored" };
    }

    const issuerUrl = q.get("issuer_url")?.trim();
    const clientId = q.get("client_id")?.trim();
    const scopes = q.get("scopes")?.trim() || "";
    const loginHint = q.get("login_hint")?.trim() || "";
    if (!issuerUrl || !clientId) {
      throw new Error("Invalid external IdP descriptor from Kiro hosted portal");
    }

    const { authorizationEndpoint, tokenEndpoint } = await discoverExternalIdpEndpoints(issuerUrl);
    const verifier = generateCodeVerifier();
    const state = generateState();
    session.phase = "external_idp";
    session.leg2 = {
      state,
      verifier,
      tokenEndpoint,
      issuerUrl,
      clientId,
      scopes,
      redirectUri: session.oauthCallbackUri,
    };

    const authUrl = buildExternalIdpAuthorizeUrl({
      authorizationEndpoint,
      clientId,
      redirectUri: session.oauthCallbackUri,
      scopes,
      codeChallenge: generateCodeChallenge(verifier),
      state,
      loginHint,
    });
    return { action: "redirect", location: authUrl };
  }

  if (reqUrl.pathname === KIRO_EXTERNAL_IDP_DEFAULTS.oauthCallbackPath) {
    if (session.phase !== "external_idp") return { action: "ignored" };
    const leg2 = session.leg2;
    const code = q.get("code")?.trim();
    const state = q.get("state")?.trim();
    const error = q.get("error")?.trim();
    const errorDescription = q.get("error_description")?.trim();

    if (!leg2) return { action: "ignored" };
    // Loopback path requires state to match leg2. Pasted URL path also accepts
    // any non-empty state — sessionId in the body is the CSRF anchor instead.
    if (trusted && (!state || state !== leg2.state)) return { action: "ignored" };
    if (error) {
      rejectOnce(session, new Error(`External IdP authorization error: ${error} ${errorDescription || ""}`.trim()));
      return { action: "failure" };
    }
    if (!code) return { action: "ignored" };

    deliverOnce(session, {
      kind: EXTERNAL_IDP_KIND,
      code,
      tokenEndpoint: leg2.tokenEndpoint,
      issuerUrl: leg2.issuerUrl,
      clientId: leg2.clientId,
      scopes: leg2.scopes,
      redirectUri: leg2.redirectUri,
      codeVerifier: leg2.verifier,
    });
    return { action: "success" };
  }

  const code = q.get("code")?.trim();
  const state = q.get("state")?.trim();
  const error = q.get("error")?.trim();
  const errorDescription = q.get("error_description")?.trim();

  if (!code && !error) return { action: "ignored" };
  if (session.phase !== "portal") return { action: "ignored" };
  // Loopback path requires state match. Pasted URL path (VPS deployment)
  // accepts any non-empty state; the body sessionId is the CSRF anchor.
  if (trusted && (!state || state !== session.state)) return { action: "ignored" };
  if (error) {
    rejectOnce(session, new Error(`Kiro SSO authorization error: ${error} ${errorDescription || ""}`.trim()));
    return { action: "failure" };
  }

  deliverOnce(session, {
    kind: SOCIAL_KIND,
    code,
    codeVerifier: session.verifier,
  });
  return { action: "success" };
}

async function postExternalIdpToken(tokenEndpoint, form) {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || text || `status ${response.status}`;
    throw new Error(`External IdP token exchange failed (${response.status}): ${detail}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
    idToken: data.id_token,
    scope: data.scope,
  };
}

export async function exchangeKiroHostedSsoCapture(capture, { region = "us-east-1" } = {}) {
  assertValidAwsRegion(region);
  const kiro = new KiroService();

  if (capture.kind === EXTERNAL_IDP_KIND) {
    validateExternalIdpEndpoint(capture.issuerUrl);
    validateExternalIdpEndpoint(capture.tokenEndpoint);

    const form = new URLSearchParams({
      client_id: capture.clientId,
      grant_type: "authorization_code",
      code: capture.code,
      redirect_uri: capture.redirectUri,
      code_verifier: capture.codeVerifier,
    });
    if (capture.scopes) form.set("scope", capture.scopes);
    const tokens = await postExternalIdpToken(capture.tokenEndpoint, form);
    return {
      ...tokens,
      authMethod: EXTERNAL_IDP_KIND,
      provider: "AzureAD",
      idp: "microsoft-entra-id",
      clientId: capture.clientId,
      tokenEndpoint: capture.tokenEndpoint,
      issuerUrl: capture.issuerUrl,
      scopes: capture.scopes || null,
      region,
      email: kiro.extractEmailFromJWT(tokens.accessToken) || kiro.extractEmailFromJWT(tokens.idToken),
      profileArn: null,
    };
  }

  const tokens = await kiro.exchangeSocialCode(capture.code, capture.codeVerifier);
  return {
    ...tokens,
    authMethod: SOCIAL_KIND,
    provider: "Kiro SSO",
    idp: "kiro-sso",
    region,
    email: kiro.extractEmailFromJWT(tokens.accessToken),
  };
}
