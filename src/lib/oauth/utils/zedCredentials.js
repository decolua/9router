import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export const ZED_DEFAULT_CREDENTIALS_URL = "https://zed.dev";
export const ZED_KEYRING_LABEL = "zed-github-account";

/**
 * Resolve the credential URL Zed uses as the keyring/keychain key.
 * Defaults to https://zed.dev; honors settings.json credentials_url → server_url.
 */
export async function resolveZedCredentialsUrl() {
  const settingsPaths = getZedSettingsPaths();
  for (const settingsPath of settingsPaths) {
    try {
      await access(settingsPath, constants.R_OK);
      const raw = await readFile(settingsPath, "utf8");
      const settings = JSON.parse(raw);
      const url =
        (typeof settings?.credentials_url === "string" && settings.credentials_url) ||
        (typeof settings?.server_url === "string" && settings.server_url) ||
        null;
      if (url) return url.replace(/\/+$/, "");
    } catch {
      // try next path
    }
  }
  return ZED_DEFAULT_CREDENTIALS_URL;
}

function getZedSettingsPaths() {
  const home = homedir();
  if (process.platform === "darwin") {
    return [join(home, "Library/Application Support/Zed/settings.json")];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [join(local, "Zed", "settings.json")];
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return [join(xdg, "zed", "settings.json")];
}

/** Candidate paths for Zed's global kv_store (holds system_id). */
export function getZedGlobalDbPaths() {
  const home = homedir();
  const channels = ["0-global", "0-stable", "0-preview"];
  if (process.platform === "darwin") {
    const base = join(home, "Library/Application Support/Zed/db");
    return channels.map((c) => join(base, c, "db.sqlite"));
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    const base = join(local, "Zed", "db");
    return channels.map((c) => join(base, c, "db.sqlite"));
  }
  const xdg = process.env.XDG_DATA_HOME || join(home, ".local", "share");
  const base = join(xdg, "zed", "db");
  return channels.map((c) => join(base, c, "db.sqlite"));
}

/**
 * Read system_id from Zed's local kv_store (same id the IDE sends to cloud.zed.dev).
 */
export async function readZedSystemId() {
  for (const dbPath of getZedGlobalDbPaths()) {
    try {
      await access(dbPath, constants.R_OK);
    } catch {
      continue;
    }
    const value = await queryKvStore(dbPath, "system_id");
    if (value) return String(value).trim();
  }
  return null;
}

async function queryKvStore(dbPath, key) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT value FROM kv_store WHERE key = ? LIMIT 1").get(key);
      return row?.value || null;
    } finally {
      db.close();
    }
  } catch {
    // Fall back to sqlite3 CLI when native bindings are unavailable.
  }

  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [dbPath, `SELECT value FROM kv_store WHERE key='${key.replace(/'/g, "''")}' LIMIT 1;`],
      { timeout: 5000, windowsHide: true },
    );
    const value = String(stdout || "").trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Read Zed IDE session credentials from the OS secret store.
 * @returns {Promise<{ found: boolean, userId?: string, accessToken?: string, systemId?: string, credentialsUrl?: string, error?: string }>}
 */
export async function readZedIdeCredentials() {
  const credentialsUrl = await resolveZedCredentialsUrl();
  let pair = null;

  if (process.platform === "linux") {
    pair = await readLinuxCredentials(credentialsUrl);
  } else if (process.platform === "darwin") {
    pair = await readMacCredentials(credentialsUrl);
  } else if (process.platform === "win32") {
    pair = await readWindowsCredentials(credentialsUrl);
  } else {
    return {
      found: false,
      error: `Zed auto-import is not supported on platform ${process.platform}`,
      credentialsUrl,
    };
  }

  if (!pair?.userId || !pair?.accessToken) {
    return {
      found: false,
      error:
        pair?.error ||
        "Zed IDE session not found in the system keyring. Sign in to Zed, then retry.",
      credentialsUrl,
    };
  }

  const systemId = (await readZedSystemId()) || randomUUID();
  return {
    found: true,
    userId: String(pair.userId),
    accessToken: String(pair.accessToken),
    systemId,
    credentialsUrl,
  };
}

async function readLinuxCredentials(credentialsUrl) {
  // Zed (oo7): attributes url + username, label "zed-github-account".
  // Note: secret-tool prints attribute.* lines on stderr and label/secret on stdout.
  try {
    const { stdout, stderr } = await execFileAsync(
      "secret-tool",
      ["search", "--all", "url", credentialsUrl],
      { timeout: 8000, windowsHide: true },
    );
    const items = parseSecretToolSearch(`${stderr || ""}\n${stdout || ""}`);
    const match =
      items.find((item) => item.label === ZED_KEYRING_LABEL && item.username && item.secret) ||
      items.find((item) => item.username && item.secret) ||
      null;
    if (match?.username && match?.secret) {
      return { userId: match.username, accessToken: match.secret };
    }
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { error: "secret-tool not found (install libsecret / secret-tools)" };
    }
    // Some secret-tool versions exit non-zero but still print useful output.
    const merged = `${err?.stderr || ""}\n${err?.stdout || ""}`;
    if (merged.includes("secret =")) {
      const items = parseSecretToolSearch(merged);
      const match = items.find((item) => item.username && item.secret);
      if (match) return { userId: match.username, accessToken: match.secret };
    }
  }

  try {
    const lookup = await execFileAsync(
      "secret-tool",
      ["lookup", "url", credentialsUrl],
      { timeout: 8000, windowsHide: true },
    );
    const accessToken = String(lookup.stdout || "").trim();
    if (!accessToken) return { error: "Empty Zed keyring secret" };

    const search = await execFileAsync(
      "secret-tool",
      ["search", "--all", "url", credentialsUrl],
      { timeout: 8000, windowsHide: true },
    );
    const items = parseSecretToolSearch(`${search.stderr || ""}\n${search.stdout || ""}`);
    const userId = items.find((i) => i.username)?.username;
    if (!userId) return { error: "Zed keyring entry missing username (user id)" };
    return { userId, accessToken };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { error: "secret-tool not found (install libsecret / secret-tools)" };
    }
    return { error: err?.stderr || err?.message || "Failed to read Linux keyring" };
  }
}

function parseSecretToolSearch(stdout) {
  // Attributes are often on stderr; callers should concatenate stderr+stdout.
  // Format:
  //   attribute.url = https://zed.dev
  //   attribute.username = 123
  //   [/60]
  //   label = zed-github-account
  //   secret = {...}
  const text = String(stdout || "");
  const username = text.match(/attribute\.username\s*=\s*(\S+)/)?.[1] || null;
  const label = text.match(/^\s*label\s*=\s*(.+)$/m)?.[1]?.trim() || null;
  const secretLine = text.match(/^\s*secret\s*=\s*(.*)$/m)?.[1];
  const secret = secretLine != null ? secretLine.trim() : null;
  if (!username && !secret && !label) return [];
  return [{ label, username, secret }];
}

async function readMacCredentials(credentialsUrl) {
  // Zed stores an internet password with kSecAttrServer = full credentials URL.
  const servers = unique([credentialsUrl, stripUrlScheme(credentialsUrl), "zed.dev"]);
  let lastError = null;

  for (const server of servers) {
    try {
      // -g prints password to stderr as "password: \"...\""
      const { stdout, stderr } = await execFileAsync(
        "security",
        ["find-internet-password", "-s", server, "-g"],
        { timeout: 8000, windowsHide: true },
      );
      const combined = `${stdout || ""}\n${stderr || ""}`;
      const password = parseSecurityPassword(combined);
      const account =
        combined.match(/"acct"<blob>="([^"]*)"/)?.[1] ||
        combined.match(/"acct"<blob>=0x[0-9A-Fa-f]+\s+"([^"]*)"/)?.[1] ||
        null;
      if (password && account) {
        return { userId: account, accessToken: password };
      }
      if (password && !account) {
        lastError = "Found Zed keychain password but missing account (user id)";
      }
    } catch (err) {
      lastError = err?.stderr || err?.message || lastError;
    }
  }
  return { error: lastError || "Zed credentials not found in macOS Keychain" };
}

function parseSecurityPassword(text) {
  const m = String(text).match(/password:\s*"(.*)"\s*$/m);
  if (m) return unescapeSecurityPassword(m[1]);
  // Empty password prints as "password: "
  if (/password:\s*$/m.test(text)) return "";
  return null;
}

function unescapeSecurityPassword(value) {
  // security escapes \ and " in the quoted password dump
  return value.replace(/\\(.)/g, "$1");
}

async function readWindowsCredentials(credentialsUrl) {
  // Zed target name: zed:url=https://zed.dev
  const target = `zed:url=${credentialsUrl}`;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ZedCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr buffer);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      string secret = "";
      if (c.CredentialBlob != IntPtr.Zero && c.CredentialBlobSize > 0) {
        byte[] bytes = new byte[c.CredentialBlobSize];
        Marshal.Copy(c.CredentialBlob, bytes, 0, (int)c.CredentialBlobSize);
        secret = Encoding.UTF8.GetString(bytes);
      }
      return (c.UserName ?? "") + "\\n" + secret;
    } finally { CredFree(p); }
  }
}
"@
$r = [ZedCred]::Read(${JSON.stringify(target)})
if ($null -eq $r) { exit 2 }
Write-Output $r
`.trim();

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    const text = String(stdout || "").replace(/^\uFEFF/, "");
    const nl = text.indexOf("\n");
    if (nl < 0) return { error: "Malformed Windows credential payload" };
    const userId = text.slice(0, nl).trim();
    const accessToken = text.slice(nl + 1).replace(/\r?\n$/, "");
    if (!userId || !accessToken) {
      return { error: "Windows Credential Manager entry missing username or secret" };
    }
    return { userId, accessToken };
  } catch (err) {
    if (err?.code === 2 || err?.status === 2) {
      return { error: "Zed credentials not found in Windows Credential Manager" };
    }
    return { error: err?.stderr || err?.message || "Failed to read Windows credentials" };
  }
}

function stripUrlScheme(url) {
  return String(url || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}
