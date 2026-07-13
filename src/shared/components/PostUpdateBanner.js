"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { APP_CONFIG, GITHUB_CONFIG } from "@/shared/constants/config";
import {
  collectChangelogHighlights,
  detectPostUpdate,
  dismissPostUpdate,
  getChangelogSectionsBetween,
} from "@/shared/utils/changelog";
import ChangelogModal from "./ChangelogModal";

/**
 * Soft banner after an upgrade: "Updated to vX — see what changed".
 * Shown once per version bump (localStorage).
 */
export default function PostUpdateBanner() {
  const [visible, setVisible] = useState(false);
  const [fromVersion, setFromVersion] = useState(null);
  const [toVersion, setToVersion] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const detected = detectPostUpdate(APP_CONFIG.version);
    if (!detected.show) return;
    setVisible(true);
    setFromVersion(detected.fromVersion);
    setToVersion(detected.toVersion);

    let cancelled = false;
    fetch(GITHUB_CONFIG.changelogUrl, { cache: "no-store" })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((md) => {
        if (cancelled) return;
        const sections = getChangelogSectionsBetween(md, detected.fromVersion, detected.toVersion);
        // If range empty (changelog not yet published on master), fall back to latest section
        const effective =
          sections.length > 0
            ? sections
            : getChangelogSectionsBetween(md, null, detected.toVersion);
        const { bullets, truncated: trunc } = collectChangelogHighlights(
          effective.length ? effective : [],
          { maxBullets: 6 },
        );
        setHighlights(bullets);
        setTruncated(trunc);
      })
      .catch(() => {
        /* banner still useful without bullets */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = () => {
    dismissPostUpdate(APP_CONFIG.version);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <>
      <div className="pointer-events-auto w-full rounded-lg border border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-200 shadow-lg backdrop-blur-sm px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] leading-5 text-green-600 dark:text-green-400 shrink-0">
            celebration
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">
              Updated to v{toVersion}
              {fromVersion ? (
                <span className="font-normal opacity-80"> (from v{fromVersion})</span>
              ) : null}
            </p>
            {!expanded && highlights.length === 0 && (
              <p className="text-[11px] opacity-80 mt-0.5">You&apos;re on the latest install.</p>
            )}
            {expanded && highlights.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[11px] opacity-90 list-disc list-inside">
                {highlights.map((b, i) => (
                  <li key={`${b.version}-${i}`} className="truncate" title={b.text}>
                    {b.text}
                  </li>
                ))}
                {truncated && (
                  <li className="list-none opacity-70 pl-0">…and more</li>
                )}
              </ul>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {highlights.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="text-[11px] font-medium underline-offset-2 hover:underline"
                >
                  {expanded ? "Hide changes" : "See what changed"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                className="text-[11px] font-medium underline-offset-2 hover:underline opacity-80"
              >
                Full changelog
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-current/70 hover:text-current shrink-0"
            aria-label="Dismiss"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}

PostUpdateBanner.propTypes = {};
