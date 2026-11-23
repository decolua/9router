"use client";

import { useEffect, useState } from "react";
import Card from "./Card";
import Button from "./Button";
import Badge from "./Badge";
import Input from "./Input";
import Toggle from "./Toggle";
// Imported by path, like the sibling components above. Not a cycle fix: the
// modal imports the barrel itself, so barrel → this card → modal → barrel
// exists either way (as it already did for the providers page). ESM tolerates
// it because every use is inside a render, not at module scope.
import AutoPingScheduleModal from "./AutoPingScheduleModal";
import { AUTO_PING_SETTINGS_KEYS } from "@/shared/constants/config";
import { describeKeepalive, formatKeepaliveTime } from "@/shared/utils/keepaliveStatus";

const ENDPOINT = "/api/cli-tools/claude-cli-accounts";
const PROVIDER = "claude-cli";
const SETTINGS_KEY = AUTO_PING_SETTINGS_KEYS[PROVIDER];

/**
 * Accounts for the Claude Code CLI provider.
 *
 * One account is one Claude Code config directory, because that is how Claude
 * Code scopes its credentials. Signing in is an interactive TUI flow, so
 * "Add account" opens a terminal pointed at a fresh directory rather than
 * collecting anything here; once /login writes its credentials the account
 * turns active and routed requests start using it.
 */
export default function ClaudeCliAccountsCard() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [token, setToken] = useState("");
  const [tokenName, setTokenName] = useState("");
  // Account being renamed, and what is typed so far.
  const [renaming, setRenaming] = useState(null);
  const [draftName, setDraftName] = useState("");
  // Cron keepalive schedules, keyed by connection id. Same settings contract the
  // other providers use, so the server-side scheduler needs no special case.
  const [cron, setCron] = useState({});
  const [scheduleTarget, setScheduleTarget] = useState(null);

  // A failed request is not the same as "Claude Code is missing". Reporting
  // the HTTP failure separately is what distinguishes "the route refused us"
  // from "the binary is not there", which previously looked identical.
  const read = async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { loadError: data.error || `Could not read accounts (HTTP ${res.status})` };
      return data;
    } catch (e) {
      return { loadError: e.message || "Could not reach 9Router" };
    }
  };

  useEffect(() => {
    let cancelled = false;
    read().then((d) => { if (!cancelled) setState(d); });
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((s) => { if (!cancelled) setCron(s?.[SETTINGS_KEY]?.cron || {}); })
      .catch(() => { /* the schedule button just starts empty */ });
    return () => { cancelled = true; };
  }, []);

  // `null` removes a schedule; anything else replaces it wholesale. Read-modify-
  // write against the live settings so a concurrent change to another key here
  // is not clobbered.
  // Applied to local state only once the server has accepted it. Showing the
  // badge first would leave the card claiming a schedule that is not saved —
  // the modal surfaces the throw, but the badge behind it would still be wrong
  // until a reload.
  const saveSchedule = async (connectionId, entry) => {
    const nextCron = { ...cron };
    if (entry) nextCron[connectionId] = entry;
    else delete nextCron[connectionId];

    const res = await fetch("/api/settings", { cache: "no-store" });
    const settings = res.ok ? await res.json() : {};
    const saved = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [SETTINGS_KEY]: { ...(settings[SETTINGS_KEY] || {}), cron: nextCron } }),
    });
    if (!saved.ok) throw new Error(`Could not save the schedule (HTTP ${saved.status})`);
    setCron(nextCron);
  };

  const reload = async () => setState(await read());

  const post = async (body) => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error || `HTTP ${res.status}`); return null; }
      if (data.how) setMessage(data.how);
      await reload();
      return data;
    } catch (e) {
      setMessage(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  // After a login window opens, the credentials file is the only signal we get.
  const check = async (id) => {
    setBusy(true);
    setPendingId(id);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      // A token account has no terminal session to finish, so telling its owner
      // to go and run /login was simply wrong — and it is the only kind of
      // account that works in a container.
      const finishHint = data.account?.kind === "token"
        ? "That token was not accepted. Generate a new one with `claude setup-token` and add it again."
        : "Not signed in yet. Finish /login in the terminal, then press Check again.";
      // `verified` means Claude returned an identity, which only happens when
      // the credential was actually accepted. `signedIn` alone just means one
      // is present — worth distinguishing, since a stale token looks signed in.
      // A token account has no profile to name: `claude auth status` reports
      // no email for one, however valid it is, so it is verified by being used
      // rather than by being identified. Saying "expired" there was wrong for
      // every container account, which is the only kind a container can have.
      const ok = data.verified
        ? (data.identity?.email
          ? `Verified as ${data.identity.email}${data.identity.orgName ? ` (${data.identity.orgName})` : ""}.`
          : "Verified: the credential was accepted. A token account carries no profile, so there is no email to show.")
        : "The credential was not accepted — it has most likely expired.";
      setMessage(data.signedIn ? ok : finishHint);
      await reload();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      setPendingId(null);
    }
  };

  const testKeepalive = async (id) => {
    setBusy(true);
    setPendingId(id);
    setMessage("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ping: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error || `HTTP ${res.status}`); return; }
      setMessage(data.ok ? "Keepalive sent." : `Keepalive failed: ${data.error || "no reason given"}`);
      await reload();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      setPendingId(null);
    }
  };

  const setScheduleOnly = async (id, scheduleOnly) => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, scheduleOnly }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error || `HTTP ${res.status}`); return; }
      setMessage(scheduleOnly
        ? "This account is reserved for scheduled pings."
        : "This account is available for provider requests again.");
      await reload();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id) => {
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error || `HTTP ${res.status}`); return; }
      setRenaming(null);
      await reload();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      await fetch(`/api/providers/${id}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const accounts = state?.accounts || [];
  const installed = state?.installed === true;
  const hostSignedIn = state?.host?.signedIn === true;
  const hostAdopted = accounts.some((a) => a.configDir === state?.host?.configDir);

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Claude Code accounts</h2>
          <p className="text-xs text-text-muted mt-1 max-w-2xl leading-relaxed">
            This provider runs the <code>claude</code> binary on the machine hosting 9Router —
            no API key, no OAuth token replay. Each account is its own Claude Code identity
            (a config directory on a desktop, a setup token in a container), so several
            subscriptions work side by side and 9Router falls back between them. Turn on
            Schedule only to reserve an account for scheduled pings.
          </p>
        </div>
        <Badge variant={state?.connectedCount > 0 ? "success" : "default"} dot>
          {state?.connectedCount > 0 ? `${state.connectedCount} Connected` : "No connections"}
        </Badge>
      </div>

      {state?.loadError && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {state.loadError}
        </div>
      )}

      {state && !state.loadError && !installed && (
        <div className="mb-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          Claude Code was not found on this machine. Install it from{" "}
          <a className="underline" href="https://claude.com/claude-code" target="_blank" rel="noreferrer">claude.com/claude-code</a>,
          or set <code>CLI_CLAUDE_BIN</code> to its path, then reload. A token
          account works regardless — it does not need a local binary.
        </div>
      )}

      {installed && (
        <div className="mb-3 text-[11px] text-text-muted break-all">
          Binary: <code>{state.bin}</code>
        </div>
      )}

      {installed && accounts.length === 0 && (
        <div className="mb-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-600 dark:text-blue-400">
          {hostSignedIn
            ? "This machine is already signed in to Claude Code. Add it as an account to start routing, or add a separate account to keep this one untouched."
            : "Nothing is signed in yet. Add an account — a terminal window opens, and you run /login there."}
        </div>
      )}

      {/* A container has no terminal for the sign-in TUI, so a token is the
          only way to attach an account there. It also works on a desktop. */}
      <div className="mb-3 rounded-lg border border-border-subtle bg-surface-2 p-3">
        <div className="text-xs text-text-main mb-1.5">
          Add an account with a token
        </div>
        <p className="text-[11px] text-text-muted mb-2 leading-relaxed">
          Run <code>claude setup-token</code> on any machine that has Claude Code and paste
          the result. This is the way to add accounts when 9Router runs in Docker, where there
          is no terminal for the interactive login. One token per account.
        </p>
        <div className="flex gap-2 flex-wrap">
          <div className="w-44">
            <Input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="Name (optional)"
              disabled={busy}
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the token from `claude setup-token`"
              disabled={busy}
            />
          </div>
          <Button
            size="sm"
            onClick={async () => {
              if (await post({ oauthToken: token, name: tokenName.trim() || undefined })) { setToken(""); setTokenName(""); }
            }}
            disabled={busy || !token.trim()}
          >
            Add token account
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        {installed && hostSignedIn && !hostAdopted && (
          <Button size="sm" icon="person_add" onClick={() => post({ adoptHost: true })} disabled={busy}>
            Use this machine&apos;s account
          </Button>
        )}
        <Button size="sm" variant="secondary" icon="add" onClick={() => post({})} disabled={busy || !installed}>
          Add another account
        </Button>
        <Button size="sm" variant="secondary" icon="refresh" onClick={reload} disabled={busy}>
          Refresh
        </Button>
      </div>

      {message && (
        <div className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-main whitespace-pre-wrap">{message}</div>
      )}

      <div className="space-y-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-start gap-3 p-3 rounded-[14px] border border-border-subtle bg-surface">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {renaming === a.id ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => { e.preventDefault(); rename(a.id); }}
                  >
                    <Input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={80}
                      autoFocus
                      disabled={busy}
                    />
                    <Button size="sm" type="submit" disabled={busy || !draftName.trim()}>Save</Button>
                    <Button size="sm" variant="secondary" type="button" onClick={() => setRenaming(null)} disabled={busy}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="text-sm font-medium text-text-main">{a.name}</span>
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-main"
                      title="Rename"
                      aria-label={`Rename ${a.name}`}
                      onClick={() => { setRenaming(a.id); setDraftName(a.name); }}
                      disabled={busy}
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                  </>
                )}
                {a.signedIn ? (
                  <Badge variant="success" size="sm" dot>Signed in</Badge>
                ) : (
                  <Badge variant="warning" size="sm" dot>Awaiting /login</Badge>
                )}
                {!a.isActive && <Badge variant="default" size="sm">Inactive</Badge>}
                {a.scheduleOnly && <Badge variant="info" size="sm">Schedule only</Badge>}
                {/* Only present once Claude accepted the credential, so it is
                    the one label here that proves the account really works. */}
                {a.identity?.subscriptionType && (
                  <Badge variant="info" size="sm">{a.identity.subscriptionType}</Badge>
                )}
                {scheduleSummary(cron[a.id]) && (
                  <Badge variant="info" size="sm">{scheduleSummary(cron[a.id])}</Badge>
                )}
              </div>
              {a.identity?.email ? (
                <div className="text-[11px] text-text-main mt-1 break-all">
                  {a.identity.email}
                  {a.identity.orgName ? ` · ${a.identity.orgName}` : ""}
                </div>
              ) : null}
              <div className="text-[11px] text-text-muted mt-1 break-all">
                {a.kind === "token" ? "Authenticated with a setup token" : a.configDir}
                {!a.identity?.email && " — press Check to confirm it works and read the account"}
              </div>
              <KeepaliveStatus keepalive={a.keepalive} schedule={cron[a.id]} />
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap">
              <Toggle
                checked={a.scheduleOnly}
                onChange={(value) => setScheduleOnly(a.id, value)}
                label="Schedule only"
                description="Exclude from provider requests"
                size="sm"
                disabled={busy}
              />
              {!a.signedIn && a.kind !== "token" && (
                <Button size="sm" variant="secondary" onClick={() => post({ id: a.id })} disabled={busy}>
                  Open login
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => check(a.id)} disabled={busy}>
                {busy && pendingId === a.id ? "Checking…" : "Check"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => testKeepalive(a.id)} disabled={busy}>
                {busy && pendingId === a.id ? "Sending…" : "Test keepalive"}
              </Button>
              {/* Same cron keepalive the OAuth providers get. It runs `claude -p`
                  as this account, which is what keeps a 5h window open without
                  replaying a token from this server. */}
              <Button
                size="sm"
                variant="secondary"
                icon="schedule"
                onClick={() => setScheduleTarget(a)}
                disabled={busy}
              >
                Schedule
              </Button>
              <Button size="sm" variant="danger" onClick={() => remove(a.id)} disabled={busy}>
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AutoPingScheduleModal
        isOpen={Boolean(scheduleTarget)}
        onClose={() => setScheduleTarget(null)}
        provider={PROVIDER}
        connection={scheduleTarget}
        value={scheduleTarget ? cron[scheduleTarget.id] : null}
        onSave={(entry) => saveSchedule(scheduleTarget.id, entry)}
      />
    </Card>
  );
}

// "0 */5 * * * · 30 2 * * * (Asia/Seoul)", or nothing when the schedule is off
// or unset. The zone is shown because an unset one runs on the server's clock.
function scheduleSummary(entry) {
  const expressions = Array.isArray(entry?.expressions) ? entry.expressions.filter(Boolean) : [];
  if (!expressions.length || entry?.enabled === false) return "";
  return `${expressions.join(" · ")} (${entry?.timezone || "server time"})`;
}

const KEEPALIVE_TONE_CLASS = {
  ok: "text-green-500",
  failed: "text-red-500",
  pending: "text-text-muted",
};

// Whether the scheduled keepalive actually went out — until now only the
// server log could tell.
function KeepaliveStatus({ keepalive, schedule }) {
  const status = describeKeepalive(keepalive, schedule);
  if (!status) return null;
  return (
    <div className={`text-[11px] mt-1 ${KEEPALIVE_TONE_CLASS[status.tone]}`}>
      {status.label}
      {status.at ? ` · ${formatKeepaliveTime(status.at, status.timezone)}` : ""}
      {status.tone === "failed" && keepalive?.lastError ? ` — ${keepalive.lastError}` : ""}
    </div>
  );
}
