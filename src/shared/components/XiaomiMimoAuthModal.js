"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * Xiaomi MiMo Desktop Plan auth modal.
 *
 * Desktop Plan = Xiaomi account weekly quota (mimo-v2.6 family). Two ways in:
 *   1. Import local MiMo Desktop credentials (~/.local/share/mimocode/auth.json)
 *   2. Server-side login — no Desktop needed; picks a MiMo account cluster
 *      (cn / sgp / ams / ru / in). The account session (passToken) is captured
 *      server-side and stored per connection.
 *
 * Token Plan (cloud sk- API key) uses the standard "API Key" entry point.
 */

const CLUSTERS = [
  { id: "cn", flag: "🇨🇳", name: "China (Mainland)", host: "mimo-server-cn" },
  { id: "sgp", flag: "🇸🇬", name: "Singapore", host: "mimo-server-sgp" },
  { id: "ams", flag: "🇪🇺", name: "Europe · Amsterdam", host: "mimo-server-ams" },
  { id: "ru", flag: "🇷🇺", name: "Russia", host: "mimo-server-ru" },
  { id: "in", flag: "🇮🇳", name: "India", host: "mimo-server-in" },
];

export default function XiaomiMimoAuthModal({ isOpen, onSuccess, onClose }) {
  const [phase, setPhase] = useState("detecting"); // detecting | found | not-found | importing
  const [detectResult, setDetectResult] = useState(null);
  const [existingConnection, setExistingConnection] = useState(null);
  const [error, setError] = useState(null);

  // Server-side session login
  const [showClusterModal, setShowClusterModal] = useState(false);
  const [sessBusy, setSessBusy] = useState(false);
  const [sessPolling, setSessPolling] = useState(false);
  const [sessError, setSessError] = useState(null);
  const [sessPageUrl, setSessPageUrl] = useState(null);
  const [sessRegion, setSessRegion] = useState("cn");
  const sessTimerRef = useRef(null);

  const stopSessionPoll = () => {
    if (sessTimerRef.current) {
      clearInterval(sessTimerRef.current);
      sessTimerRef.current = null;
    }
    setSessPolling(false);
  };

  useEffect(() => () => stopSessionPoll(), []);

  // Detect local credentials when the modal opens (non-blocking: never trap the spinner)
  useEffect(() => {
    if (!isOpen) return;

    setPhase("detecting");
    setError(null);
    setDetectResult(null);
    setExistingConnection(null);
    setShowClusterModal(false);
    setSessError(null);

    const runDetect = async () => {
      try {
        const res = await fetch("/api/oauth/xiaomi-mimo/auto-import", {
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();

        if (data.found && data.apiKey) {
          setDetectResult(data);
          setPhase("found");

          // Non-blocking: flag an already-imported account
          fetch("/api/providers", { signal: AbortSignal.timeout(3000) })
            .then((r) => r.json())
            .then((provData) => {
              const foundConn = (provData.connections || []).find(
                (c) =>
                  c.provider === "xiaomi-mimo" &&
                  data.uid &&
                  (c.email === `${data.uid}@xiaomi` ||
                    c.providerSpecificData?.uid === data.uid ||
                    c.providerSpecificData?.mimoUserId === data.uid),
              );
              if (foundConn) setExistingConnection(foundConn);
            })
            .catch(() => {});
        } else {
          setPhase("not-found");
        }
      } catch {
        setPhase("not-found");
      }
    };

    runDetect();
  }, [isOpen]);

  // Import the auto-detected local desktop credentials
  const handleImportLocal = async () => {
    if (!detectResult?.apiKey) return;
    setPhase("importing");
    setError(null);

    try {
      const res = await fetch("/api/oauth/xiaomi-mimo/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: detectResult.apiKey,
          uid: detectResult.uid,
          baseUrl: detectResult.baseUrl,
          mimoPassToken: detectResult.mimoPassToken || null,
          mimoUserId: detectResult.mimoUserId || null,
          mimoCUserId: detectResult.mimoCUserId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Import failed");
      onSuccess?.(data.connection);
      onClose();
    } catch (err) {
      setPhase("found");
      setError(err.message);
    }
  };

  // Server-side login (account.xiaomi.com) for the chosen cluster
  const startSessionLogin = async (region) => {
    setSessBusy(true);
    setSessError(null);
    setShowClusterModal(false);
    setSessRegion(region);
    try {
      const res = await fetch("/api/oauth/xiaomi-mimo/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      const data = await res.json();
      if (!res.ok || !data.pageUrl) throw new Error(data.error || "Failed to start login");
      setSessPageUrl(data.pageUrl);
      window.open(data.pageUrl, "mimo-session-login", "width=500,height=760");
      setSessPolling(true);
      const startedAt = Date.now();
      sessTimerRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 14 * 60 * 1000) {
          stopSessionPoll();
          setSessError("Login timed out. Please retry.");
          return;
        }
        try {
          const sres = await fetch(`/api/oauth/xiaomi-mimo/login/status?state=${data.state}`);
          const sd = await sres.json();
          if (sd.status === "pending") return;
          stopSessionPoll();
          if (sd.status !== "done") {
            setSessError(sd.error || "Login session expired — please retry.");
            return;
          }
          const save = await fetch("/api/oauth/xiaomi-mimo/api-key", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey: "",
              uid: sd.userId || null,
              mimoPassToken: sd.passToken,
              mimoUserId: sd.userId || null,
              mimoCUserId: sd.cUserId || null,
              region: sd.region || sessRegion,
            }),
          });
          const saved = await save.json();
          if (!save.ok || !saved.success) throw new Error(saved.error || "Failed to save credentials");
          onSuccess?.(saved.connection);
          onClose();
        } catch (err) {
          stopSessionPoll();
          setSessError(err.message);
        }
      }, 2500);
    } catch (err) {
      setSessError(err.message);
    } finally {
      setSessBusy(false);
    }
  };

  // The server-login card, shown in both the found and not-found states
  const renderServerLogin = () => (
    <div className="bg-card p-3 rounded-lg border border-border flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-primary text-base">login</span>
          <span className="text-xs sm:text-sm font-semibold">Browser Login</span>
          <span className="text-[11px] text-text-muted">No Desktop required</span>
        </div>
        <span className="text-[11px] text-text-muted">Weekly quota</span>
      </div>
      {sessPolling ? (
        <div className="flex flex-col gap-1.5">
          <Button variant="outline" size="sm" fullWidth disabled>
            Waiting for login...
          </Button>
          {sessPageUrl && (
            <Button
              onClick={() => window.open(sessPageUrl, "mimo-session-login", "width=500,height=760")}
              variant="ghost"
              size="sm"
              fullWidth
            >
              Reopen login window
            </Button>
          )}
        </div>
      ) : (
        <Button onClick={() => setShowClusterModal(true)} variant="outline" size="sm" fullWidth disabled={sessBusy}>
          {sessBusy ? "Starting..." : "Choose cluster & sign in"}
        </Button>
      )}
      {sessError && <p className="text-[11px] text-red-500">{translate(sessError)}</p>}
    </div>
  );

  return (
    <Modal isOpen={isOpen} title={translate("Connect Xiaomi MiMo")} onClose={onClose} size="lg">
      <div className="flex flex-col gap-3.5">
        {/* Detecting */}
        {phase === "detecting" && (
          <div className="text-center py-6">
            <div className="size-12 mx-auto mb-3 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <p className="text-sm text-text-muted">Reading local MiMo Desktop credentials...</p>
          </div>
        )}

        {/* Importing */}
        {phase === "importing" && (
          <div className="text-center py-6">
            <div className="size-12 mx-auto mb-3 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <p className="text-sm font-medium">Connecting...</p>
          </div>
        )}

        {/* Found local desktop credentials */}
        {phase === "found" && detectResult && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted px-0.5">
              <span className="material-symbols-outlined text-primary text-sm">desktop_windows</span>
              <span>Desktop Plan · Local credentials</span>
            </div>

            {existingConnection ? (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex gap-2.5 items-start">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-lg mt-0.5">
                    check_circle
                  </span>
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-medium">This account is already connected (no need to import again)</p>
                    <p className="text-xs mt-0.5 opacity-80">
                      UID: {detectResult.uid || "—"} · Status: {existingConnection.testStatus === "active" ? "Active" : "Untested"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex gap-2.5 items-start">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400 text-lg mt-0.5">
                    check_circle
                  </span>
                  <div className="text-sm text-green-800 dark:text-green-200">
                    <p className="font-medium">Xiaomi MiMo Desktop credentials found!</p>
                    <p className="text-xs mt-0.5 opacity-80">
                      UID: {detectResult.uid || "—"} · Source: {detectResult.source?.split(/[\\/]/).pop()}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-2.5 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-600 dark:text-red-400">{translate(error)}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleImportLocal} variant={existingConnection ? "outline" : "default"} fullWidth>
                {existingConnection ? "Re-sync local credentials" : "Connect with local credentials"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                {existingConnection ? "Close" : "Cancel"}
              </Button>
            </div>

            <div className="relative my-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs text-text-muted">
                <span className="bg-card px-2">or</span>
              </div>
            </div>

            {renderServerLogin()}
          </div>
        )}

        {/* No local desktop credentials */}
        {phase === "not-found" && (
          <div className="flex flex-col gap-3">
            <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex gap-2.5 items-start">
                <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-lg mt-0.5">info</span>
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  <p className="font-medium">No local Desktop credentials found</p>
                  <p className="text-xs mt-0.5 opacity-80">
                    You can still sign in via browser — no Desktop client needed.
                  </p>
                </div>
              </div>
            </div>

            {renderServerLogin()}

            <div className="mt-1">
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Cluster selection sub-modal */}
        {showClusterModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="relative w-full max-w-sm bg-surface border border-border-subtle rounded-[14px] shadow-2xl p-5 flex flex-col gap-3.5 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-lg">public</span>
                  <h3 className="text-sm font-semibold">Select account cluster</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClusterModal(false)}
                  className="text-text-muted hover:text-text-primary p-1 rounded-md transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>

              <p className="text-xs text-text-muted">Choose the region cluster of your Xiaomi account:</p>

              <div className="flex flex-col gap-2">
                {CLUSTERS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => startSessionLogin(c.id)}
                    className="p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-all text-left flex items-start gap-3 group cursor-pointer"
                  >
                    <span className="text-2xl mt-0.5">{c.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold group-hover:text-primary transition-colors">
                        {c.name}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">{c.host}</div>
                    </div>
                  </button>
                ))}
              </div>

              <Button onClick={() => setShowClusterModal(false)} variant="ghost" size="sm" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

XiaomiMimoAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
