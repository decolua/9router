import { NextResponse } from "next/server";
import { access, constants, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Zed stores cloud login under the credentials URL (usually https://zed.dev). */
const ZED_CREDENTIAL_URLS = [
  "https://zed.dev",
  "https://cloud.zed.dev",
  "http://localhost:3000",
];

/**
 * Candidate paths for Zed development credentials / config.
 * Production credentials live in the OS keychain (libsecret / Keychain).
 */
function getCandidatePaths(platform) {
  const home = homedir();
  const paths = [
    join(home, ".local/share/zed/credentials"),
    join(home, ".local/share/zed/development_credentials"),
    join(home, ".config/zed/credentials"),
    join(home, ".config/zed/development_credentials"),
  ];
  if (platform === "darwin") {
    paths.push(
      join(home, "Library/Application Support/Zed/credentials"),
      join(home, "Library/Application Support/Zed/development_credentials"),
    );
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    paths.push(
      join(appData, "Zed", "credentials"),
      join(appData, "Zed", "development_credentials"),
    );
  }
  return paths;
}

/**
 * Parse Zed credential payloads.
 * - Plain: "{user_id} {access_token}"
 * - Keyring JSON v2: {"version":2,"id":"client_token_…","token":"…"} (+ username from attrs)
 * - Legacy JSON: {user_id, access_token}
 */
function parseCredentialsPayload(raw, usernameHint = null) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();

  const spaced = trimmed.match(/^(\d+)\s+(\S+)$/);
  if (spaced) {
    return { userId: spaced[1], accessToken: spaced[2] };
  }

  try {
    const parsed = JSON.parse(trimmed);
    // Zed keyring v2: the entire JSON blob IS the access_token used in
    // Authorization: "{userId} {json}". Inner `.token` alone returns 401.
    if (parsed?.version === 2 && typeof parsed.token === "string") {
      const userId = usernameHint || parsed.user_id || parsed.userId;
      if (userId != null && /^\d+$/.test(String(userId))) {
        return { userId: String(userId), accessToken: trimmed };
      }
      return null;
    }

    const userId =
      usernameHint ||
      parsed.user_id ||
      parsed.userId ||
      (typeof parsed.id === "number" || /^\d+$/.test(String(parsed.id || ""))
        ? parsed.id
        : null) ||
      parsed?.user?.id;
    const accessToken =
      parsed.access_token || parsed.accessToken || parsed.token;
    if (userId != null && accessToken) {
      return { userId: String(userId), accessToken: String(accessToken) };
    }
  } catch {
    /* not JSON — maybe raw token with username hint */
    if (usernameHint && /^\d+$/.test(String(usernameHint)) && trimmed.length >= 16) {
      return { userId: String(usernameHint), accessToken: trimmed };
    }
  }
  return null;
}

/**
 * Parse `secret-tool search` multi-line output into {username, secret}.
 */
function parseSecretToolSearch(stdout) {
  if (!stdout) return null;
  let username = null;
  let secret = null;
  for (const line of stdout.split("\n")) {
    const mUser = line.match(/^attribute\.username\s*=\s*(.+)\s*$/);
    if (mUser) username = mUser[1].trim();
    const mSecret = line.match(/^secret\s*=\s*(.+)\s*$/);
    if (mSecret) secret = mSecret[1].trim();
  }
  if (!secret) return null;
  return parseCredentialsPayload(secret, username);
}

async function trySecretTool() {
  // Prefer search (attributes on stderr, secret on stdout).
  for (const url of ZED_CREDENTIAL_URLS) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "secret-tool",
        ["search", "--all", "url", url],
        { timeout: 8000 },
      );
      const parsed = parseSecretToolSearch(`${stdout || ""}\n${stderr || ""}`);
      if (parsed?.userId && parsed?.accessToken) return parsed;
    } catch {
      /* try next */
    }
  }

  for (const url of ZED_CREDENTIAL_URLS) {
    try {
      const { stdout } = await execFileAsync(
        "secret-tool",
        ["lookup", "url", url],
        { timeout: 5000 },
      );
      // lookup has no username — cannot use JSON v2 alone
      const parsed = parseCredentialsPayload(stdout);
      if (parsed?.userId && parsed?.accessToken) return parsed;
    } catch {
      /* try next */
    }
  }

  // Legacy attribute guesses
  for (const [attr, value] of [
    ["application", "zed"],
    ["service", "zed"],
    ["service", "https://zed.dev"],
  ]) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "secret-tool",
        ["search", "--all", attr, value],
        { timeout: 5000 },
      );
      const parsed = parseSecretToolSearch(`${stdout || ""}\n${stderr || ""}`);
      if (parsed?.userId && parsed?.accessToken) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function tryMacKeychain() {
  // Zed stores under service = credentials URL (https://zed.dev)
  for (const service of ZED_CREDENTIAL_URLS) {
    try {
      const { stdout: secret } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", service, "-w"],
        { timeout: 5000 },
      );
      let account = null;
      try {
        const { stdout: meta } = await execFileAsync(
          "security",
          ["find-generic-password", "-s", service, "-g"],
          { timeout: 5000 },
        );
        const m = meta.match(/"acct"<blob>="([^"]+)"/) || meta.match(/acct[^"]*"([^"]+)"/);
        if (m) account = m[1];
      } catch {
        /* account optional for some formats */
      }
      const parsed = parseCredentialsPayload(secret.trim(), account);
      if (parsed?.userId && parsed?.accessToken) return parsed;
    } catch {
      /* try next service */
    }
  }

  // Fallback label search
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-l", "zed-github-account", "-w"],
      { timeout: 5000 },
    );
    return parseCredentialsPayload(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * GET /api/oauth/zed/auto-import
 * Best-effort auto-detect Zed credentials from local files / keyring.
 */
export async function GET() {
  try {
    const platform = process.platform;
    const candidates = getCandidatePaths(platform);

    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        const raw = await readFile(candidate, "utf8");
        const parsed = parseCredentialsPayload(raw);
        if (parsed?.userId && parsed?.accessToken) {
          return NextResponse.json({
            found: true,
            userId: parsed.userId,
            accessToken: parsed.accessToken,
            source: candidate,
          });
        }
      } catch {
        /* try next */
      }
    }

    if (platform === "linux") {
      const fromSecret = await trySecretTool();
      if (fromSecret?.userId && fromSecret?.accessToken) {
        return NextResponse.json({
          found: true,
          userId: fromSecret.userId,
          accessToken: fromSecret.accessToken,
          source: "secret-tool:url=https://zed.dev",
        });
      }
    }

    if (platform === "darwin") {
      const fromKeychain = await tryMacKeychain();
      if (fromKeychain?.userId && fromKeychain?.accessToken) {
        return NextResponse.json({
          found: true,
          userId: fromKeychain.userId,
          accessToken: fromKeychain.accessToken,
          source: "keychain",
        });
      }
    }

    return NextResponse.json({
      found: false,
      windowsManual: true,
      error:
        "Zed credentials not found automatically. Paste your user ID and access token manually.",
      checked: candidates,
    });
  } catch (error) {
    console.log("Zed auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
