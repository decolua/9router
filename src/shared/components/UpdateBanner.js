"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Button from "./Button";
import { GITHUB_CONFIG } from "@/shared/constants/config";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

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
 * Banner that appears when the running install sits behind the repository. It is
 * driven by /api/version, which reports an update either from git (a checkout that
 * is N commits behind) or from the changelog (a newer release exists), so a deploy
 * without git history is still told to update.
 */
export default function UpdateBanner({ pollMs = POLL_MS }) {
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState("");
  const { copied, copy } = useCopyToClipboard(2000);

  useEffect(() => {
    setDismissed(readDismissed());

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
  }, [pollMs]);

  if (!info) return null;

  // A newer release than the one dismissed re-opens the banner; the same one stays
  // closed for this browser.
  const identity = info.latestVersion || "";
  if (!identity || dismissed === identity) return null;

  const installCmd = info.installCmd || "npm i -g 9router@latest --prefer-online";
  const behind = Number.isFinite(info.behindBy) ? info.behindBy : null;
  const summary = behind !== null && behind > 0
    ? `This install is ${behind} commit${behind > 1 ? "s" : ""} behind master.`
    : info.currentRelease
      ? `${info.currentRelease} is installed and ${info.latestVersion} is published.`
      : `${info.latestVersion} is published on the repository.`;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, identity);
    } catch {
      // Storage blocked: the banner simply comes back after a reload.
    }
    setDismissed(identity);
  };

  return (
    <div className="mx-6 lg:mx-10 mb-4 max-w-7xl">
      <div className="flex flex-col gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center">
        <span className="material-symbols-outlined shrink-0 text-[20px] text-amber-500">system_update_alt</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Update available: {info.latestVersion}
          </p>
          <p className="text-xs text-text-muted">{summary}</p>
          {Array.isArray(info.releaseNotes) && info.releaseNotes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {info.releaseNotes.slice(0, 3).map((note) => (
                <li key={note} className="truncate text-xs text-text-muted" title={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <code className="hidden select-all overflow-x-auto whitespace-nowrap rounded-lg border border-border-subtle bg-bg px-2.5 py-1.5 font-mono text-[11px] text-text-muted sm:block">
            {installCmd}
          </code>
          <Button
            variant="outline"
            size="sm"
            icon={copied ? "check" : "content_copy"}
            onClick={() => copy(installCmd)}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <a href={GITHUB_CONFIG.repoUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="sm" icon="open_in_new">
              GitHub
            </Button>
          </a>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded p-1 text-text-muted transition-colors hover:text-amber-500"
            title="Close"
            aria-label="Dismiss update notice"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      </div>
    </div>
  );
}

UpdateBanner.propTypes = {
  pollMs: PropTypes.number,
};
