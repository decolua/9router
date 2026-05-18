/**
 * Devin AI service helpers.
 *
 * Devin CLI authenticates via OAuth PKCE → JWT, then talks to two backends:
 *   • api.devin.ai (user profile)
 *   • server.codeium.com (Windsurf inference, Connect/protobuf)
 *
 * The api_key the CLI sends in protobuf bodies AND the Authorization header
 * has the literal prefix "devin-session-token$" — without it, every chat
 * request fails with `invalid_argument`. Authorization for the inference
 * endpoint is `Basic <prefixed>-<prefixed>` (the prefixed token doubled,
 * separated by a hyphen).
 */

const SELF_URL = "https://api.devin.ai/v3/self";

function withDevinPrefix(token) {
  if (!token) return token;
  return token.startsWith("devin-session-token$") ? token : `devin-session-token$${token}`;
}

/**
 * Validate a Devin session token and fetch the user profile.
 * Returns { username, email, orgId } on success; throws on failure.
 */
export async function validateAndImportKey(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("Empty Devin token");
  }

  const apiKey = withDevinPrefix(rawToken);
  const auth = `Bearer ${apiKey}`;

  const res = await fetch(SELF_URL, {
    method: "GET",
    headers: { Authorization: auth, Accept: "application/json" },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Invalid Devin token (${res.status})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Devin /v3/self failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => ({}));
  return {
    username: data.name || data.user_name || data.email || "Devin User",
    email: data.email || "",
    orgId: data.organization_id || data.org_id || "",
  };
}

// ── Pasted-token import (windsurf.com/show-auth-token) ───────────────────────
// dwgx/WindsurfAPI v2.0.91 path: PostAuth with the Auth1 token from
// windsurf.com/show-auth-token. Returns devin-session-token$<JWT>.
// - empty application/proto body
// - X-Devin-Auth1-Token header (not in body)
// - Chrome-shaped fingerprint (without it the new host returns 401)

const POST_AUTH_URL_NEW = "https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth";
const POST_AUTH_URL_LEGACY = "https://server.self-serve.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth";

const CHROME_FINGERPRINT = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "application/json, text/plain, */*",
  "Accept-Encoding": "identity",
  "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
  "Origin": "https://windsurf.com",
};

function parsePostAuthResponse(raw) {
  const text = typeof raw === "string" ? raw : (raw?.toString?.("utf8") || "");
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") return j;
  } catch {}
  // Binary proto fallback: scan for the embedded session token / account id.
  const sessionToken = text.match(/devin-session-token\$[A-Za-z0-9._-]+/)?.[0];
  const accountId = text.match(/account-[a-f0-9]+/)?.[0];
  const primaryOrgId = text.match(/org-[a-f0-9]+/)?.[0];
  if (sessionToken) return { sessionToken, accountId, primaryOrgId };
  return { error: text.slice(0, 200) || "empty response" };
}

async function callPostAuth(url, auth1Token) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...CHROME_FINGERPRINT,
      "Content-Type": "application/proto",
      "Content-Length": "0",
      "Connect-Protocol-Version": "1",
      "X-Devin-Auth1-Token": auth1Token,
      Referer: "https://windsurf.com/account/login",
    },
    body: new Uint8Array(0),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, data: parsePostAuthResponse(buf) };
}

/**
 * Exchange a Windsurf Auth1 token (from windsurf.com/show-auth-token) for a
 * devin-session-token. Tries the new windsurf.com _backend host first, falls
 * back to server.self-serve.windsurf.com on 5xx / network failure.
 */
export async function exchangeAuth1ForSessionToken(auth1Token) {
  if (!auth1Token || typeof auth1Token !== "string") {
    throw new Error("Empty Windsurf auth token");
  }
  const cleaned = auth1Token.trim();

  const errors = [];
  for (const [url, label] of [[POST_AUTH_URL_NEW, "new"], [POST_AUTH_URL_LEGACY, "legacy"]]) {
    try {
      const r = await callPostAuth(url, cleaned);
      const sessionToken = r.data?.sessionToken;
      if (r.status >= 200 && r.status < 300 && sessionToken) {
        return {
          sessionToken,
          accountId: r.data.accountId || "",
          orgId: r.data.primaryOrgId || "",
        };
      }
      const errBody = JSON.stringify(r.data || {}).slice(0, 200);
      errors.push(`${label}=HTTP ${r.status} ${errBody}`);
      // 4xx is meaningful — the other host won't accept it either
      if (r.status >= 400 && r.status < 500) break;
    } catch (e) {
      errors.push(`${label}=${e.message}`);
    }
  }
  throw new Error(`WindsurfPostAuth failed: ${errors.join(" | ")}`);
}

// ── RegisterUser (for ott$ tokens) ───────────────────────────────────────────
// dwgx's WindsurfClient.registerUser passes the pasted token as
// `firebase_id_token` to register.windsurf.com / api.codeium.com — both
// accept Firebase ID tokens AND `ott$<base64>` tokens at that field.

const REGISTER_URL_NEW = "https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser";
const REGISTER_URL_LEGACY = "https://api.codeium.com/register_user/";

async function callRegisterUser(url, token) {
  const bodyStr = JSON.stringify({ firebase_id_token: token });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...CHROME_FINGERPRINT,
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(bodyStr)),
      "Connect-Protocol-Version": "1",
      "Accept": "application/json",
    },
    body: bodyStr,
  });
  let data = null;
  const raw = await res.text();
  try { data = JSON.parse(raw); } catch {}
  return { status: res.status, data, raw };
}

async function exchangeOttForApiKey(ottToken) {
  const errors = [];
  for (const [url, label] of [[REGISTER_URL_NEW, "new"], [REGISTER_URL_LEGACY, "legacy"]]) {
    try {
      const r = await callRegisterUser(url, ottToken);
      const apiKey = r.data?.api_key || r.data?.apiKey;
      const name = r.data?.name || "";
      if (r.status >= 200 && r.status < 300 && apiKey) {
        return {
          sessionToken: apiKey,
          name,
          accountId: r.data?.account_id || r.data?.accountId || "",
          orgId: r.data?.organization_id || r.data?.orgId || "",
        };
      }
      errors.push(`${label}=HTTP ${r.status} ${(r.raw || "").slice(0, 200)}`);
      if (r.status >= 400 && r.status < 500) break;
    } catch (e) {
      errors.push(`${label}=${e.message}`);
    }
  }
  throw new Error(`RegisterUser failed: ${errors.join(" | ")}`);
}

// ── GetUserStatus (team identity + quota) ───────────────────────────────────
// dwgx v2.0.90: GetUserStatus accepts the prefixed sessionToken directly as
// metadata.apiKey. Returns email + teamId so we can disambiguate two
// connections that share the same Windsurf user but live in different
// Devin team workspaces.

const USER_STATUS_HOSTS = [
  "https://server.codeium.com",
  "https://server.self-serve.windsurf.com",
];
const USER_STATUS_PATH = "/exa.seat_management_pb.SeatManagementService/GetUserStatus";

async function fetchDevinUserStatus(prefixedToken) {
  const body = JSON.stringify({
    metadata: {
      apiKey: prefixedToken,
      ideName: "windsurf",
      ideVersion: "1.9600.41",
      extensionName: "windsurf",
      extensionVersion: "1.9600.41",
      locale: "en",
    },
  });
  for (const host of USER_STATUS_HOSTS) {
    try {
      const res = await fetch(`${host}${USER_STATUS_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          Accept: "application/json",
          "User-Agent": "windsurf/1.9600.41",
        },
        body,
      });
      if (!res.ok) continue;
      const data = await res.json();
      const us = data?.userStatus || {};
      // teamId looks like "devin-team$account-e86c71783e0f4516a7cea09f1aa1c6e6"
      const teamId = us.teamId || "";
      const accountMatch = teamId.match(/account-([a-f0-9]+)/);
      return {
        username: us.name || "",
        email: us.email || "",
        teamId,
        accountId: accountMatch?.[1] || "",
        teamShort: accountMatch ? accountMatch[1].slice(0, 4) : "",
        plan: us?.planStatus?.planInfo?.planName || "",
      };
    } catch {
      // try next host
    }
  }
  return null;
}

function withTeamSuffix(username, teamShort) {
  if (!username) return username;
  if (!teamShort) return username;
  if (username.includes(`(team-${teamShort})`)) return username;
  return `${username} (team-${teamShort})`;
}

/**
 * One-shot import from a Windsurf auth token. Detects token shape:
 *   - `ott$<base64>` → exchange via RegisterUser to mint a real apiKey
 *   - `devin-session-token$<JWT>` or bare JWT → use directly
 */
export async function validateAndImportAuth1Token(rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("Empty Windsurf auth token");
  }
  const cleaned = rawToken.trim();
  if (cleaned.length < 10) {
    throw new Error("Token too short — paste the full token from windsurf.com/show-auth-token");
  }

  const hasWhitespace = /\s/.test(cleaned);
  const isPrintableAscii = /^[\x21-\x7e]+$/.test(cleaned);
  if (hasWhitespace || !isPrintableAscii || cleaned.length < 20) {
    throw new Error("That doesn't look like a Windsurf auth token. Open windsurf.com/show-auth-token and copy ONLY the token string — it's a single line of letters, numbers, dots, and dashes.");
  }

  // OTT path: exchange for a real apiKey via RegisterUser.
  let sessionToken;
  let baseUsername = "";
  let baseAccountId = "";
  let baseOrgId = "";
  let baseEmail = "";

  if (cleaned.startsWith("ott$")) {
    const reg = await exchangeOttForApiKey(cleaned);
    sessionToken = withDevinPrefix(reg.sessionToken);
    baseUsername = reg.name || "Devin";
    baseAccountId = reg.accountId || "";
    baseOrgId = reg.orgId || "";
  } else {
    // Direct-session path: token is already a sessionToken (bare or prefixed).
    sessionToken = withDevinPrefix(cleaned);
    try {
      const profile = await validateAndImportKey(sessionToken);
      baseUsername = profile.username || "Devin User";
      baseEmail = profile.email || "";
      baseOrgId = profile.orgId || "";
    } catch {
      baseUsername = `Devin (${cleaned.slice(0, 8)}…)`;
    }
  }

  // Enrich with GetUserStatus → teamId so the connection name disambiguates
  // when one Windsurf user has multiple Devin team workspaces.
  const status = await fetchDevinUserStatus(sessionToken);
  const username = withTeamSuffix(
    status?.username || baseUsername,
    status?.teamShort || ""
  );
  const email = status?.email || baseEmail;
  const teamId = status?.teamId || "";

  return {
    sessionToken,
    accountId: status?.accountId || baseAccountId || "",
    username,
    email,
    orgId: baseOrgId,
    teamId,
  };
}
