/**
 * The Claude Code accounts route, against a real Next server.
 *
 *   node scripts/fork/check-claude-accounts.mjs
 *
 * Exists because of a bug that unit tests could not have caught: the account
 * listing and the "Check" button each decided signed-in state for themselves,
 * and only the listing knew that a token account carries its own credential.
 * Check looked for a credentials *file*, never found one, reported the account
 * signed out and wrote isActive:false — switching off the only kind of account
 * that works in a container, and telling its owner to go and finish /login in
 * a terminal that does not exist.
 *
 * So this drives the real route: add a token account, list it, press Check,
 * and assert the account is still signed in and still active afterwards.
 *
 * Uses `next dev` (no production build needed) with the wrapper loaded through
 * NODE_OPTIONS, and a scratch DATA_DIR that is removed at the end — it never
 * touches real 9Router state.
 *
 * Note: booting `next dev` makes Next re-add its agent-rules block to
 * CLAUDE.md. That is expected and not this script's doing — `git checkout --
 * CLAUDE.md` afterwards, or upgrade-fork.mjs will refuse the dirty tree.
 *
 * Takes a few minutes and needs port 21995 free.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROUTER_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 21995;
const PASSWORD = "claude-accounts-test-password";
const ROUTE = "/api/cli-tools/claude-cli-accounts";
const DATA_DIR = path.join(os.tmpdir(), `9r-claude-accounts-${Date.now()}`);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const call = (opts, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: "127.0.0.1", port: PORT, timeout: 120000, ...opts }, (res) => {
    let data = "";
    res.on("data", (c) => { data += c; });
    res.on("end", () => {
      let json = null;
      try { json = JSON.parse(data); } catch { /* keep raw */ }
      resolve({ status: res.statusCode, headers: res.headers, body: data, json });
    });
  });
  r.on("error", reject);
  r.on("timeout", () => r.destroy(new Error("request timeout")));
  if (body) r.write(body);
  r.end();
});

const waitFor = async (fn, ms, label) => {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${label} (${last})`);
};

let server;
let log = "";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.JWT_SECRET;
  server = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "--port", String(PORT)], {
      cwd: ROOT,
      env: {
        ...env,
        DATA_DIR,
        INITIAL_PASSWORD: PASSWORD,
        // NODE_OPTIONS is parsed shell-style: quote a spaced path, and use
        // forward slashes because backslashes read as escapes.
        NODE_OPTIONS: `--require "${path.join(ROOT, "custom-server.js").replace(/\\/g, "/")}"`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  await waitFor(async () => (await call({ method: "GET", path: "/api/health" })).status < 500,
    180000, "next dev to answer");

  const login = await call({ method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
    JSON.stringify({ password: PASSWORD }));
  const m = /auth_token=([^;]+)/.exec([].concat(login.headers["set-cookie"] || []).join("; "));
  check("dashboard login issues a session", Boolean(m), `status=${login.status}`);
  const cookie = m ? `auth_token=${m[1]}` : null;
  if (!cookie) throw new Error("cannot continue without a session");
  const json = { cookie, "content-type": "application/json" };

  // A setup token is an opaque string to this route; it is not validated
  // against the API here, which is what makes this testable offline.
  const token = `sk-ant-oat01-test-${Date.now()}`;
  const added = await call({ method: "POST", path: ROUTE, headers: json },
    JSON.stringify({ oauthToken: token }));
  check("a token account can be added", added.status === 201 && Boolean(added.json?.account?.id),
    `status=${added.status} body=${added.body.slice(0, 200)}`);
  const id = added.json?.account?.id;

  const listed = await call({ method: "GET", path: ROUTE, headers: { cookie } });
  const account = listed.json?.accounts?.find((a) => a.id === id);
  check("it is listed as a token account, signed in", account?.kind === "token" && account?.signedIn === true,
    `kind=${account?.kind} signedIn=${account?.signedIn}`);
  check("the card would show it connected", (listed.json?.connectedCount ?? 0) >= 1,
    `connectedCount=${listed.json?.connectedCount}`);

  // The regression. Before the fix this returned signedIn:false and wrote
  // isActive:false, because it looked for a credentials file a token account
  // does not have.
  const checked = await call({ method: "PATCH", path: ROUTE, headers: json }, JSON.stringify({ id }));
  check("Check reports a token account as signed in", checked.json?.signedIn === true,
    `signedIn=${checked.json?.signedIn} body=${checked.body.slice(0, 200)}`);
  check("Check leaves it active rather than switching it off",
    checked.json?.account?.isActive === true,
    `isActive=${checked.json?.account?.isActive}`);

  // The token used here is fabricated, so Claude cannot return an account for
  // it. `signedIn` is still true — a credential is present — but `verified`
  // must not be, or the card would call a dead token good.
  check("a fabricated token is signed-in but NOT verified",
    checked.json?.verified === false && !checked.json?.identity?.email,
    `verified=${checked.json?.verified} identity=${JSON.stringify(checked.json?.identity)}`);

  const after = await call({ method: "GET", path: ROUTE, headers: { cookie } });
  const stillThere = after.json?.accounts?.find((a) => a.id === id);
  check("it survives Check as an active, signed-in account",
    stillThere?.signedIn === true && stillThere?.isActive === true,
    `signedIn=${stillThere?.signedIn} isActive=${stillThere?.isActive}`);
  check("and is still counted as connected", (after.json?.connectedCount ?? 0) >= 1,
    `connectedCount=${after.json?.connectedCount}`);

  // The old check wrote isActive:false for every token account, leaving one
  // showing "Signed in" and "Inactive" at once, counting as no connections,
  // with nothing in the UI to switch it back on. Reconstruct that exact state
  // and confirm it heals.
  await call({ method: "PUT", path: `/api/providers/${id}`, headers: json },
    JSON.stringify({ isActive: false, testStatus: "pending" }));
  const broken = await call({ method: "GET", path: ROUTE, headers: { cookie } });
  const healed = broken.json?.accounts?.find((a) => a.id === id);
  check("an account the old check disabled is re-enabled on load",
    healed?.isActive === true && healed?.signedIn === true,
    `isActive=${healed?.isActive} signedIn=${healed?.signedIn}`);
  check("...and counts as a connection again", (broken.json?.connectedCount ?? 0) >= 1,
    `connectedCount=${broken.json?.connectedCount}`);

  // Surgical, not a blanket re-enable: an account switched off deliberately
  // keeps a different testStatus and must be left alone.
  await call({ method: "PUT", path: `/api/providers/${id}`, headers: json },
    JSON.stringify({ isActive: false, testStatus: "active" }));
  const deliberate = await call({ method: "GET", path: ROUTE, headers: { cookie } });
  check("an account disabled on purpose stays disabled",
    deliberate.json?.accounts?.find((a) => a.id === id)?.isActive === false,
    "the repair must not override a deliberate choice");
  await call({ method: "PUT", path: `/api/providers/${id}`, headers: json },
    JSON.stringify({ isActive: true, testStatus: "active" }));

  // Multi-account is the point of this route existing.
  const second = await call({ method: "POST", path: ROUTE, headers: json },
    JSON.stringify({ oauthToken: `${token}-b` }));
  const both = await call({ method: "GET", path: ROUTE, headers: { cookie } });
  check("a second token account can be added", second.status === 201, `status=${second.status}`);
  check("both are counted", (both.json?.connectedCount ?? 0) >= 2,
    `connectedCount=${both.json?.connectedCount}`);

  const dup = await call({ method: "POST", path: ROUTE, headers: json }, JSON.stringify({ oauthToken: token }));
  check("the same token twice is refused", dup.status === 409, `status=${dup.status}`);

  // /api/providers is what the Providers *list* reads, and it now awaits the
  // account repair before returning rows. Two things are checked here: the
  // route still answers, and the claude-cli row is actually in its payload with
  // authType "none" — the value the grid filter used to drop, which is why the
  // card showed accounts while the list said "No connections".
  const list = await call({ method: "GET", path: "/api/providers", headers: { cookie } });
  const listed2 = (list.json?.connections || []).filter((c) => c.provider === "claude-cli");
  check("/api/providers still answers with the repair in front of it",
    list.status === 200 && Array.isArray(list.json?.connections),
    `status=${list.status} body=${list.body.slice(0, 200)}`);
  check("the claude-cli row reaches the list payload as authType none",
    listed2.length >= 1 && listed2.every((c) => c.authType === "none"),
    `rows=${listed2.length} authTypes=${JSON.stringify(listed2.map((c) => c.authType))}`);
  check("...and carries a countable testStatus, so the grid shows it connected",
    listed2.some((c) => c.testStatus === "active" || c.testStatus === "success"),
    `testStatuses=${JSON.stringify(listed2.map((c) => c.testStatus))}`);

  // The quota tracker reads /api/providers/client, whose eligibility test used
  // to be "authType is oauth, or an allow-listed apikey provider". claude-cli
  // stores accounts as authType "none", so it could never appear there however
  // many accounts were signed in.
  const eligible = await call({
    method: "GET",
    path: "/api/providers/client?page=1&pageSize=100&accountStatus=all&sort=priority",
    headers: { cookie },
  });
  const trackedRows = (eligible.json?.connections || []).filter((c) => c.provider === "claude-cli");
  check("the quota tracker counts claude-cli as eligible",
    eligible.status === 200 && trackedRows.length >= 1,
    `status=${eligible.status} rows=${trackedRows.length} options=${JSON.stringify(eligible.json?.providerOptions)}`);
  check("...and offers it in the provider filter",
    (eligible.json?.providerOptions || []).includes("claude-cli"),
    `options=${JSON.stringify(eligible.json?.providerOptions)}`);

  // And the figures themselves. Claude Code reports no window remaining and no
  // reset, so these are 9Router's own counts — the contract is that they never
  // masquerade as a subscription limit.
  const routed = await call({ method: "GET", path: `/api/usage/${encodeURIComponent(id)}`, headers: { cookie } });
  const routedQuotas = routed.json?.quotas || {};
  check("usage returns routed figures for a claude-cli account",
    routed.status === 200 && Object.keys(routedQuotas).length > 0,
    `status=${routed.status} body=${routed.body.slice(0, 200)}`);
  check("every routed figure is flagged unlimited, with no reset invented",
    Object.values(routedQuotas).every((q) => q.unlimited === true && q.resetAt === null),
    `quotas=${JSON.stringify(routedQuotas).slice(0, 200)}`);
  check("...and the payload says the numbers are 9Router's own",
    /9Router/.test(routed.json?.message || "") && routed.json?.source === "9router",
    `message=${routed.json?.message} source=${routed.json?.source}`);

  // The Update button next to Recheck runs `claude update` and reads the
  // version back from the same probe the badge uses. On a machine with no
  // binary it must refuse cleanly rather than throw.
  const updated = await call({ method: "POST", path: "/api/cli-tools/claude-cli-settings", headers: json });
  const settings = (await call({ method: "GET", path: "/api/cli-tools/claude-cli-settings", headers: { cookie } })).json;
  const installed = settings?.installed;
  // The card hides the Update button when this is true, because an in-container
  // update cannot be made durable — so the flag has to be reported, not implied.
  check("status reports whether this is a container",
    typeof settings?.containerised === "boolean" || installed !== true,
    `containerised=${settings?.containerised}`);
  if (installed) {
    check("the Update button reports a version, updated or already current",
      updated.status === 200 && typeof updated.json?.version === "string",
      `status=${updated.status} body=${updated.body.slice(0, 250)}`);
    check("...and says which of the two happened",
      updated.json?.updated === true || updated.json?.unchanged === true || Boolean(updated.json?.error),
      `updated=${updated.json?.updated} unchanged=${updated.json?.unchanged} error=${updated.json?.error}`);
  } else {
    check("the Update button refuses cleanly with no binary installed",
      updated.status === 400 && /not installed/i.test(updated.json?.error || ""),
      `status=${updated.status} body=${updated.body.slice(0, 200)}`);
  }

  // The Schedule button on the accounts card writes a cron entry under the
  // claude-cli auto-ping settings key, exactly like the OAuth providers do
  // under theirs. Proving the round-trip here is what distinguishes "the button
  // saves" from "the button appears": the settings route has an explicit list of
  // keys that restart the scheduler, and a key missing from it saves silently
  // and never runs until the next process restart.
  const schedule = {
    enabled: true,
    expressions: ["0 */5 * * *"],
    timezone: "Asia/Seoul",
    text: "Only Hi",
    via: "cli",
  };
  const savedSchedule = await call({ method: "PATCH", path: "/api/settings", headers: json },
    JSON.stringify({ claudeCliAutoPing: { connections: {}, cron: { [id]: schedule } } }));
  check("a claude-cli schedule can be saved", savedSchedule.status === 200,
    `status=${savedSchedule.status} body=${savedSchedule.body.slice(0, 200)}`);

  const readBack = await call({ method: "GET", path: "/api/settings", headers: { cookie } });
  const storedEntry = readBack.json?.claudeCliAutoPing?.cron?.[id];
  check("it survives a read-back with its expression and timezone",
    storedEntry?.expressions?.[0] === "0 */5 * * *" && storedEntry?.timezone === "Asia/Seoul",
    `stored=${JSON.stringify(storedEntry)}`);
  // via:"cli" is the only transport this provider has — the binary holds the
  // session, so there is no token for an "api" ping to replay.
  check("...and keeps via:cli, the only transport claude-cli has",
    storedEntry?.via === "cli", `via=${storedEntry?.via}`);

  const cleared = await call({ method: "PATCH", path: "/api/settings", headers: json },
    JSON.stringify({ claudeCliAutoPing: { connections: {}, cron: {} } }));
  const afterClear = await call({ method: "GET", path: "/api/settings", headers: { cookie } });
  check("clearing the schedule removes it",
    cleared.status === 200 && !afterClear.json?.claudeCliAutoPing?.cron?.[id],
    `cron=${JSON.stringify(afterClear.json?.claudeCliAutoPing?.cron)}`);

  // Removal is not on this route — the card deletes the underlying connection.
  await call({ method: "DELETE", path: `/api/providers/${encodeURIComponent(id)}`, headers: { cookie } });
} catch (e) {
  check("harness completed", false, e.message);
} finally {
  if (server) server.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

const pass = results.filter((r) => r.ok).length;
if (pass !== results.length) console.log(`\n--- server log tail ---\n${log.slice(-2500)}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
