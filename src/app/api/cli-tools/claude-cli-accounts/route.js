import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { DATA_DIR } from "@/lib/dataDir";
import {
  getProviderConnections,
  createProviderConnection,
  updateProviderConnection,
} from "@/models";
import { resolveClaudeBin } from "open-sse/executors/claude-cli.js";
// One definition of "is this account signed in", shared with the boot-time
// repair — it existed twice before, and the copy behind "Check" was wrong.
import { accountSignedIn, credentialsFileExists, repairClaudeCliAccounts } from "@/shared/services/claudeCliAccountRepair";

export const dynamic = "force-dynamic";

const PROVIDER = "claude-cli";
// Claude Code keeps its credentials per config directory, so one directory is
// one account. Giving each connection its own is what makes several accounts
// usable at once — see CLAUDE_CONFIG_DIR in open-sse/config/claudeCli.js.
const ACCOUNTS_DIR = path.join(DATA_DIR, "claude-cli-accounts");
// Whether a config directory has a completed login. The account-level check is
// accountSignedIn; this one is used for the *host* directory, which is not an
// account and cannot carry a token.
const isSignedIn = credentialsFileExists;

/** The account the host itself is signed into, used when no connection exists. */
function hostConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude");
}


/**
 * Ask Claude Code who an account actually is.
 *
 * `claude auth status --json` is the only account-level information the CLI
 * exposes without a terminal, and it has one subtlety that matters: `loggedIn`
 * is a *local* check. A deliberately invalid token still reports
 * `loggedIn: true` with `authMethod: "oauth_token"`, because a credential is
 * present.
 *
 * What it cannot fake is the identity. `email`, `orgName` and
 * `subscriptionType` only appear when the credential was accepted by the
 * server — with a bogus token those fields are simply absent. So their
 * presence, not `loggedIn`, is the signal worth trusting, and it comes with
 * something worth showing: which account this actually is.
 *
 * Spawns the binary, so this belongs on Check and not on every page load.
 */
/**
 * The environment a probe runs the binary under.
 *
 * The account's own credential and nothing else of the server's: a host that
 * has CLAUDE_CODE_OAUTH_TOKEN of its own would otherwise answer for an account
 * attached by directory, and the card would name the wrong subscription.
 */
function buildProbeEnv(psd = {}) {
  const env = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (psd.configDir) env.CLAUDE_CONFIG_DIR = psd.configDir;
  else if (process.env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
  if (psd.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = psd.oauthToken;
  return env;
}

async function accountIdentity(bin, psd = {}, timeoutMs = 30_000) {
  if (!bin) return null;
  const env = buildProbeEnv(psd);

  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn(bin, ["auth", "status", "--json"], { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      done(null);
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } done(null); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", () => { clearTimeout(timer); done(null); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
        done({
          loggedIn: json.loggedIn === true,
          authMethod: json.authMethod || "",
          email: typeof json.email === "string" ? json.email : "",
          orgName: typeof json.orgName === "string" ? json.orgName : "",
          subscriptionType: typeof json.subscriptionType === "string" ? json.subscriptionType : "",
        });
      } catch {
        done(null);
      }
    });
  });
}

/**
 * Does this credential actually work?
 *
 * `auth status` cannot answer that for a token account. Measured on 2.1.281:
 * with CLAUDE_CODE_OAUTH_TOKEN set it reports `loggedIn: true`,
 * `authMethod: "oauth_token"` and NO email, orgName or subscriptionType at
 * all — the fields are absent rather than empty, and a deliberately invalid
 * token reports exactly the same thing. It is a local check; it never asks the
 * server. So "identity came back" is a test a token account can never pass,
 * however valid it is, and Check told every container operator their working
 * token looked expired.
 *
 * The only way to know is to use it. One word in, one word out — the smallest
 * request that proves the credential was accepted, on an explicit button press.
 */
async function credentialAccepted(bin, psd = {}, timeoutMs = 60_000) {
  if (!bin) return false;
  const env = buildProbeEnv(psd);
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawn(bin, [
        "-p", "--output-format", "stream-json", "--verbose",
        "--model", "haiku", "--max-turns", "1", "--tools", "",
        "--setting-sources", "", "--strict-mcp-config",
        "--permission-mode", "dontAsk", "--disable-slash-commands",
      ], { env, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      done(false);
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } done(false); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", () => { clearTimeout(timer); done(false); });
    child.on("close", () => {
      clearTimeout(timer);
      const accepted = out.split("\n").some((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) return false;
        try {
          const event = JSON.parse(trimmed);
          return event.type === "result" && event.subtype === "success" && event.is_error !== true;
        } catch { return false; }
      });
      done(accepted);
    });
    child.stdin.end("Reply with the single word OK.");
  });
}

async function describe(connection) {
  const psd = connection.providerSpecificData || {};
  const configDir = psd.configDir || "";
  const signedIn = await accountSignedIn(psd);
  return {
    id: connection.id,
    name: connection.name || connection.displayName || "Claude Code account",
    email: connection.email || "",
    configDir,
    kind: psd.oauthToken ? "token" : (psd.kind || "isolated"),
    signedIn,
    isActive: connection.isActive !== false,
    scheduleOnly: psd.scheduleOnly === true,
    testStatus: connection.testStatus,
    createdAt: connection.createdAt,
    // Recorded by the last Check, when the server accepted the credential.
    // Absent until then, and absent for a credential that was rejected.
    identity: psd.identity || null,
    // Written by the auto-ping scheduler, so the card can show whether the
    // scheduled keepalive actually went out — the log is the only other place.
    keepalive: {
      lastSentAt: connection.lastCronPingAt || null,
      lastFailedAt: connection.lastCronFailedAt || null,
    },
  };
}

/**
 * Open an interactive Claude Code session so the user can run /login.
 *
 * This is the one place a console is required: Claude Code's sign-in is an
 * interactive TUI flow, so there is nothing to collect from a fetch. The
 * routed request path never does this — it spawns the binary directly with no
 * shell (see executors/claude-cli.js).
 *
 * The directory is server-generated, never caller-supplied, so nothing the
 * user types reaches the command line.
 */
function launchLoginWindow(bin, configDir) {
  if (process.platform === "win32") {
    // `start` is a cmd builtin, so cmd is unavoidable here. The title argument
    // ("") must come first or start treats the quoted path as the title.
    const child = spawn(
      "cmd",
      ["/c", "start", "", "cmd", "/k", `set "CLAUDE_CONFIG_DIR=${configDir}" && "${bin}"`],
      { detached: true, stdio: "ignore", windowsHide: false },
    );
    child.unref();
    return { launched: true, how: "A terminal window opened. Run /login there, then come back and press Check." };
  }

  const terminals = [
    ["x-terminal-emulator", ["-e", bin]],
    ["gnome-terminal", ["--", bin]],
    ["konsole", ["-e", bin]],
    ["open", ["-a", "Terminal", bin]],
  ];
  for (const [cmd, args] of terminals) {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      });
      child.unref();
      return { launched: true, how: "A terminal window opened. Run /login there, then come back and press Check." };
    } catch {
      // try the next one
    }
  }
  return {
    launched: false,
    how: `No terminal could be opened. Run this yourself:\n  CLAUDE_CONFIG_DIR="${configDir}" ${bin}\nthen /login.`,
  };
}

// GET /api/cli-tools/claude-cli-accounts — accounts and their sign-in state
/**
 * Undo the damage the old check did.
 *
 * It wrote `isActive: false` whenever it decided an account was signed out,
 * and it decided that for every token account because it looked for a
 * credentials file they do not have. The result was an account showing
 * "Signed in" and "Inactive" at once, counting as no connections, with no
 * control anywhere to re-enable it.
 *
 * The fingerprint is exact: inactive, `testStatus` left at "pending", and
 * actually able to authenticate. This card has never offered a disable
 * control, so nothing else writes that combination — an account someone
 * switched off deliberately elsewhere keeps a different testStatus and is left
 * alone.
 */
export async function GET() {
  try {
    const bin = resolveClaudeBin();
    let connections = await getProviderConnections({ provider: PROVIDER });
    if (await repairClaudeCliAccounts(connections)) {
      connections = await getProviderConnections({ provider: PROVIDER });
    }
    const accounts = await Promise.all(connections.map(describe));

    // With no accounts configured the provider falls back to whatever the host
    // is signed into, so report that too rather than claiming nothing works.
    const hostDir = hostConfigDir();
    return NextResponse.json({
      installed: !!bin,
      bin: bin || "",
      accounts,
      connectedCount: accounts.filter((a) => a.signedIn && a.isActive).length,
      host: { configDir: hostDir, signedIn: await isSignedIn(hostDir) },
    });
  } catch (error) {
    console.log("Error listing claude-cli accounts:", error);
    return NextResponse.json({ error: "Failed to list accounts" }, { status: 500 });
  }
}

// POST — add an account and open its login window, or re-open an existing one
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    // Token account: the only way to attach an account where no interactive
    // login is possible, which is the normal case in a container. Generated
    // with `claude setup-token` on any machine that can run the TUI.
    if (typeof body.oauthToken === "string" && body.oauthToken.trim()) {
      const token = body.oauthToken.trim();
      const existing = await getProviderConnections({ provider: PROVIDER });
      if (existing.some((c) => c.providerSpecificData?.oauthToken === token)) {
        return NextResponse.json({ error: "That token is already added." }, { status: 409 });
      }
      const created = await createProviderConnection({
        provider: PROVIDER,
        authType: "none",
        accessToken: "cli",
        name: body.name || `Token account ${existing.length + 1}`,
        displayName: body.name || `Token account ${existing.length + 1}`,
        providerSpecificData: { oauthToken: token, kind: "token" },
        testStatus: "active",
        isActive: true,
      });
      return NextResponse.json({ account: await describe(created) }, { status: 201 });
    }

    const bin = resolveClaudeBin();
    if (!bin) {
      return NextResponse.json(
        {
          error: "Claude Code is not installed here. Install it, set CLI_CLAUDE_BIN, "
            + "or add an account with a token from `claude setup-token`.",
        },
        { status: 400 },
      );
    }

    // Re-open the login window for an account that exists already.
    if (body.id) {
      // getProviderConnections filters by provider and isActive only.
      const match = (await getProviderConnections({ provider: PROVIDER })).find((c) => c.id === body.id);
      if (!match) return NextResponse.json({ error: "Account not found" }, { status: 404 });
      const configDir = match.providerSpecificData?.configDir;
      if (!configDir) return NextResponse.json({ error: "That account has no config directory" }, { status: 400 });
      await fs.mkdir(configDir, { recursive: true });
      return NextResponse.json({ ...launchLoginWindow(bin, configDir), id: match.id, configDir });
    }

    // Adopt the account the host is already signed into, rather than making
    // the user log in again for the first one.
    if (body.adoptHost === true) {
      const hostDir = hostConfigDir();
      if (!(await isSignedIn(hostDir))) {
        return NextResponse.json({ error: "This machine is not signed in to Claude Code yet." }, { status: 400 });
      }
      const existing = await getProviderConnections({ provider: PROVIDER });
      if (existing.some((c) => c.providerSpecificData?.configDir === hostDir)) {
        return NextResponse.json({ error: "This machine's account is already added." }, { status: 409 });
      }
      const created = await createProviderConnection({
        provider: PROVIDER,
        authType: "none",
        accessToken: "cli",
        name: body.name || "This machine",
        displayName: body.name || "This machine",
        providerSpecificData: { configDir: hostDir, kind: "host" },
        testStatus: "active",
        isActive: true,
      });
      return NextResponse.json({ account: await describe(created) }, { status: 201 });
    }

    const configDir = path.join(ACCOUNTS_DIR, randomUUID());
    await fs.mkdir(configDir, { recursive: true });

    const created = await createProviderConnection({
      provider: PROVIDER,
      authType: "none",
      accessToken: "cli",
      name: body.name || "Claude Code account",
      displayName: body.name || "Claude Code account",
      providerSpecificData: { configDir, kind: "isolated" },
      // Not usable until the login completes; the routed path skips inactive
      // connections, so an unfinished login cannot swallow traffic.
      testStatus: "pending",
      isActive: false,
    });

    return NextResponse.json(
      { account: await describe(created), ...launchLoginWindow(bin, configDir) },
      { status: 201 },
    );
  } catch (error) {
    console.log("Error adding claude-cli account:", error);
    return NextResponse.json({ error: error.message || "Failed to add account" }, { status: 500 });
  }
}

// PATCH — re-check sign-in state and activate an account once it has logged in
export async function PATCH(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const connections = await getProviderConnections({ provider: PROVIDER });
    const target = connections.find((c) => c.id === body.id);
    if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    if (typeof body.scheduleOnly === "boolean") {
      const updated = await updateProviderConnection(target.id, {
        providerSpecificData: {
          ...target.providerSpecificData,
          scheduleOnly: body.scheduleOnly,
        },
      });
      if (!updated) return NextResponse.json({ error: "Account not found" }, { status: 404 });
      return NextResponse.json({ account: await describe(updated) });
    }

    const signedIn = await accountSignedIn(target.providerSpecificData);

    // Ask who this account is. An identity comes back only when the server
    // accepted the credential, so it upgrades "a credential is present" into
    // "this credential works, and it belongs to <email>" — and gives the card
    // something better to show than "Token account 1".
    const bin = resolveClaudeBin();
    const identity = await accountIdentity(bin, target.providerSpecificData);
    // An email proves it on its own. A token account never has one — see
    // credentialAccepted — so it is proven by using the credential instead,
    // and only when there is no cheaper answer already.
    const verified = Boolean(identity?.email)
      || (signedIn && await credentialAccepted(bin, target.providerSpecificData));

    // testStatus records what the check found. isActive records whether the
    // operator wants the account used, and a check must never clear it: the
    // previous version wrote `isActive: signedIn`, so one bad check left a
    // perfectly good account switched off with nothing in the UI to switch it
    // back on. A successful check may re-enable one, since pressing Check is a
    // deliberate act — a failing one leaves it alone.
    await updateProviderConnection(target.id, {
      ...(signedIn ? { isActive: true } : {}),
      testStatus: signedIn ? "active" : "pending",
      ...(identity?.email ? { email: identity.email } : {}),
      existingProviderSpecificData: {
        ...target.providerSpecificData,
        ...(identity ? { identity } : {}),
      },
    });

    const [refreshed] = (await getProviderConnections({ provider: PROVIDER })).filter((c) => c.id === target.id);
    return NextResponse.json({
      account: await describe(refreshed || target),
      signedIn,
      // Distinguishes "a credential is present" from "the server accepted it".
      verified,
      identity,
    });
  } catch (error) {
    console.log("Error checking claude-cli account:", error);
    return NextResponse.json({ error: "Failed to check account" }, { status: 500 });
  }
}
