"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "./Card";
import Button from "./Button";
import Badge from "./Badge";

const STATUS_ENDPOINT = "/api/cli-tools/claude-cli-settings";

/**
 * Install status for the Claude Code CLI provider.
 *
 * There is nothing to sign in to from here: the provider spawns the local
 * `claude` binary, which uses whatever account that binary is already logged
 * into. This card reports the exact binary the runtime will spawn so the
 * dashboard and the executor can never disagree.
 */
export default function ClaudeCliStatusCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  // `claude update` downloads a build, so this is a slow button with its own
  // state — the version badge is what confirms it landed.
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);

  // Mount load runs as a promise chain (no setState in the effect body).
  useEffect(() => {
    let cancelled = false;
    fetch(STATUS_ENDPOINT, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch((e) => { if (!cancelled) setStatus({ installed: false, hint: e.message }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(STATUS_ENDPOINT, { cache: "no-store" });
      setStatus(await res.json());
    } catch (e) {
      setStatus({ installed: false, hint: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  // Runs `claude update` and re-reads the version from the same probe Recheck
  // uses, so the badge cannot disagree with what actually got installed.
  const update = useCallback(async () => {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const res = await fetch(STATUS_ENDPOINT, { method: "POST" });
      const data = await res.json();
      setUpdateResult(data);
      if (data.version) setStatus((prev) => ({ ...(prev || {}), version: data.version }));
      else await refresh();
    } catch (e) {
      setUpdateResult({ error: e.message });
    } finally {
      setUpdating(false);
    }
  }, [refresh]);

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Claude Code CLI</h2>
          <p className="text-sm text-text-muted">
            Runs `claude -p` locally instead of replaying an OAuth token from this server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <Badge variant="default">Checking…</Badge>
          ) : status?.installed ? (
            <Badge variant="success">{status.version || "Installed"}</Badge>
          ) : (
            <Badge variant="danger">Not installed</Badge>
          )}
          <Button size="sm" variant="secondary" icon="refresh" onClick={refresh} disabled={loading || updating}>
            Recheck
          </Button>
          {/* Only when a binary is actually present — there is nothing to
              update otherwise, and the route would just refuse.

              In a container the button is left out entirely rather than
              offered and failed: the image installs Claude Code as root under
              /usr/local, the runtime user cannot write there, and even a
              successful update would be lost on the next restart. The note
              below says what to do instead. */}
          {status?.installed && !status?.containerised && (
            <Button
              size="sm"
              variant="secondary"
              icon="system_update_alt"
              onClick={update}
              disabled={loading || updating}
            >
              {updating ? "Updating…" : "Update"}
            </Button>
          )}
        </div>
      </div>

      {status?.bin && (
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">
          <span className="font-medium text-text-main">Binary:</span> {status.bin}
          {status.source ? ` (${status.source})` : ""}
        </div>
      )}

      {/* In a container there is no Update button, so say what to do instead —
          otherwise the version just looks stuck with no explanation. */}
      {status?.installed && status?.containerised && (
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted leading-relaxed">
          Updating from here is not possible in a container: Claude Code is installed as root under{" "}
          <code>/usr/local</code> and this process does not run as root. Even if it could, the new
          version would live in the writable layer and be lost on the next restart. Bump{" "}
          <code>CLAUDE_CODE_VERSION</code> in the Dockerfile and rebuild the image instead.
        </div>
      )}

      {/* What the update actually did. "Already current" is a result, not a
          non-event — without saying so, a no-op looks like a broken button. */}
      {updateResult && (
        <div
          className={`mt-2 rounded-lg px-3 py-2 text-xs ${
            updateResult.error
              ? "border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
              : "bg-surface-2 text-text-muted"
          }`}
        >
          {updateResult.updated
            ? `Updated ${updateResult.before || "?"} → ${updateResult.version}.`
            : updateResult.unchanged
              ? `Already on the latest version (${updateResult.version}).`
              : updateResult.error || "The update finished without reporting a version."}
          {updateResult.hint && (
            <p className="mt-1 leading-relaxed">{updateResult.hint}</p>
          )}
          {updateResult.output && !updateResult.unchanged && (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] opacity-80">
              {updateResult.output}
            </pre>
          )}
        </div>
      )}

      {(status?.hint || status?.authHint) && (
        <p className="mt-3 text-xs text-text-muted">{status.hint || status.authHint}</p>
      )}

      <p className="mt-3 text-xs text-text-muted">
        Sign in once with `claude` → /login on this machine. Tool calling is not supported on this provider.
      </p>
    </Card>
  );
}
