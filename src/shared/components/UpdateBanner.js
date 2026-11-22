"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import PropTypes from "prop-types";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import ManualUpdatePanel from "./ManualUpdatePanel";
import { GITHUB_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useSessionStore } from "@/store/sessionStore";

// updateCheck reads the changelog heading verbatim, so the tag already rides
// along ("v0.5.165", or "git-abc1234" when there is no release yet). A caller
// that prints `v${latestVersion}` by hand ends up with "vv0.5.165" - one
// leading "v", exactly once.
function formatVersion(version) {
  if (typeof version !== "string" || !version) return "";
  return version.startsWith("v") ? version : `v${version}`;
}

// Ten minutes between checks: fast enough that a release shows up while the tab is
// open, slow enough that GitHub is not polled on every navigation.
const POLL_MS = 600000;
const DISMISSED_KEY = "9router:dismissedUpdate";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Version tag. The same chip the welcome dialog sets next to its wordmark:
 * a bordered mono label in theme tokens, so it survives dark and glass without
 * a colour of its own.
 */
function VersionChip({ children }) {
  return (
    <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-normal text-text-muted">
      {children}
    </span>
  );
}

VersionChip.propTypes = {
  children: PropTypes.node,
};

/**
 * The one place update status lives: every install that sits behind the
 * repository is told about it here, on the dashboard itself.
 *
 * Sidebar used to carry a second copy of this (a text line, an "Update now"
 * button and the install command). Two copies drifted apart, and the sidebar one
 * appeared without any motion on route changes, so the flow lives here alone:
 * status line, copy command, the manual update panel, and dismissal. Nothing is
 * duplicated between the two surfaces.
 *
 * Driven by /api/version, which reports an update either from git (a checkout
 * that is N commits behind) or from the changelog (a newer release exists), so
 * a deploy without git history is still told to update.
 *
 * The card is the welcome dialog's surface, not an alert: same bg-surface fill,
 * same 1px border-border-subtle edge, same 14px radius, and the header row the
 * welcome dialog opens with - an icon tile at size-11/rounded-xl, a title in
 * text-primary, a version chip, one muted line under it - then the actions.
 * Before this, the banner was an amber-tinted strip (bg-amber-500/10, amber
 * text, amber hover) which is the one treatment in the dashboard that no theme
 * token could reach: it sat on top of dark and glass with its own colour and
 * read as a foreign element. Colour here comes from the tokens alone, exactly
 * as the welcome dialog's does; the update glyph is the only accent. Same
 * radius and border as every other panel means it reads as part of the page
 * instead of an interruption painted over it.
 */
export default function UpdateBanner({ pollMs = POLL_MS }) {
  // Re-keyed per route below, so the banner briefly exits and re-enters on
  // navigation instead of sitting frozen while the page swaps beneath it.
  const pathname = usePathname();
  // The sidebar already resolves the session once for the whole shell; reading it
  // here instead of fetching /api/auth/status again removes both the duplicate
  // request and the window in which `isApiKeyUser` is still false for a key
  // session -- during which the version poll ran and the banner flashed.
  const sessionRole = useSessionStore((state) => state.role);
  const sessionLoaded = useSessionStore((state) => state.loaded);
  const sessionReady = sessionLoaded === true;
  const isApiKeyUser = sessionReady && sessionRole === "apikey";

  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [closing, setClosing] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const { copied, copy } = useCopyToClipboard(2000);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  // Update notices are an administrator surface: a key-signed session skips it
  // instead of firing a request it may not read (same rule as Sidebar). Waiting
  // on `sessionReady` is what removes the flash -- before the role was known the
  // poll ran, the response landed, and the banner painted for a key session
  // until the separate status fetch caught up.
  useEffect(() => {
    if (!sessionReady || isApiKeyUser) return undefined;

    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data?.hasUpdate) setInfo(data);
      } catch {
        // Offline or blocked: leave the last answer on screen.
      }
    };

    check();
    const id = setInterval(check, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs, sessionReady, isApiKeyUser]);

  // Shutdown countdown is owned here now that the panel lives here: copy the
  // command, wait out the countdown, then stop the server so the operator can
  // paste it into a terminal.
  useEffect(() => {
    if (shutdownCountdown <= 0) return undefined;
    const id = setTimeout(() => {
      fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
      setShutdownCountdown(0);
      setIsDisconnected(true);
    }, 1000);
    return () => clearTimeout(id);
  }, [shutdownCountdown]);

  const installCmd = info?.installCmd || UPDATER_CONFIG.installCmdLatest;

  const handleCopyAndShutdown = () => {
    navigator.clipboard?.writeText(installCmd).catch(() => { /* clipboard blocked */ });
    copy(installCmd);
    setShutdownCountdown(UPDATER_CONFIG.shutdownCountdownSec);
  };

  const handleCancel = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  if (isApiKeyUser) return null;

  // A newer release than the one dismissed re-opens the banner; the same one stays
  // closed for this browser.
  const identity = info?.latestVersion || "";
  const visible = Boolean(info) && Boolean(identity) && dismissed !== identity;
  const latestVersion = formatVersion(info?.latestVersion);

  const handleDismiss = () => {
    // Animate out first: without this the dismiss is an instant pop
    // and the content below jumps up with no transition.
    setClosing(true);
    setTimeout(() => {
      try {
        window.localStorage.setItem(DISMISSED_KEY, identity);
      } catch {
        // Storage blocked: the banner simply comes back after a reload.
      }
      setDismissed(identity);
      setClosing(false);
    }, 200);
  };

  // Keep the update flow reachable even after dismissal: the banner itself can be
  // dismissed, the manual update panel cannot be left without an exit.
  if (!info) return null;

  return (
    <>
      {visible && (
        // In-flow, not fixed: this sits above the content inside the layout, so
        // scrolling the page moves it like any other block instead of sticking.
        <div
          key={pathname}
          className={`w-full mb-4 ${closing ? "pointer-events-none -translate-y-2 opacity-0 transition-all duration-200 ease-in" : "slide-in-top"}`}
        >
          <div className="rounded-[14px] border border-border-subtle bg-surface px-5 py-4 shadow-[var(--shadow-elev)]">
            {/* Header: icon tile, title with its version tag, one muted line
                under it - the welcome dialog's header row with the update
                glyph where the product mark sits. */}
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border-subtle text-primary">
                <span className="material-symbols-outlined text-[22px]">upgrade</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight leading-tight text-primary">
                  Update available
                  {latestVersion && <VersionChip>{latestVersion}</VersionChip>}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{summaryFor(info)}</p>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="-mr-1 shrink-0 rounded p-1 text-text-muted transition-colors hover:text-primary"
                title="Close"
                aria-label="Dismiss update notice"
              >
                <span className="material-symbols-outlined text-[16px]">cancel</span>
              </button>
            </div>

            {/* Release notes, listed the way the welcome dialog lists its facts:
                the card is already the container, so the list needs none of its
                own, and a note cut mid-word is a note nobody can read. */}
            {Array.isArray(info.releaseNotes) && info.releaseNotes.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-main marker:text-text-muted">
                {info.releaseNotes.slice(0, 3).map((note) => (
                  <li key={note} className="leading-relaxed">
                    {note}
                  </li>
                ))}
              </ul>
            )}

            {/* Actions, in the welcome dialog's row. The command stays visible
                and selectable; copying it is the job of "Update now" ->
                "Copy & Shutdown", so a second Copy button here only offered the
                same clipboard write twice. */}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="hidden select-all overflow-x-auto whitespace-nowrap rounded-lg border border-border-subtle bg-bg px-2.5 py-1.5 font-mono text-[11px] text-text-muted sm:block">
                {installCmd}
              </code>
              <Button
                variant="primary"
                fullWidth
                className="sm:w-auto"
                onClick={() => setShowConfirm(true)}
              >
                Update now
              </Button>
              <a
                href={GITHUB_CONFIG.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-main transition-colors hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined text-[16px]">launch</span>
                GitHub
              </a>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={() => {
          setShowConfirm(false);
          setIsUpdating(true);
        }}
        title="Update 9Router"
        message={`Update 9Router to ${formatVersion(info.latestVersion)}? The install command is copied and the server shuts down so you can run it in a terminal.`}
        confirmText="Update"
        cancelText="Cancel"
        variant="primary"
      />

      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim  p-6 fade-in">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={info.latestVersion}
              installCmd={installCmd}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancel}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                <span className="material-symbols-outlined text-[32px]">power_settings_new</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Server Disconnected</h2>
              <p className="text-text-muted mb-6">The proxy server has been stopped.</p>
              <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** One line describing how far behind this install is. */
function summaryFor(info) {
  const behind = Number.isFinite(info.behindBy) ? info.behindBy : null;
  if (behind !== null && behind > 0) {
    return `This install is ${behind} commit${behind > 1 ? "s" : ""} behind master.`;
  }
  if (info.currentRelease) {
    return `${info.currentRelease} is installed and ${info.latestVersion} is published.`;
  }
  return `${info.latestVersion} is published on the repository.`;
}

UpdateBanner.propTypes = {
  pollMs: PropTypes.number,
};
