"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Button from "./Button";
import ChangelogModal from "./ChangelogModal";
import { GITHUB_CONFIG } from "@/shared/constants/config";

// Post-login welcome dialog.
//
// One surface, not a banner inside a banner. Earlier versions nested a rounded
// panel (surface-2, border, dot-grid) inside the Modal - which is itself a
// rounded bordered panel - and put three more mini-cards inside that. Three
// layers of the same container reads as decoration, and the middle layer was
// carrying no information the surrounding dialog did not already carry.
//
// So the dialog's own surface is the only surface. Content sits directly on it:
// the product mark and wordmark as the header (replacing the generic Modal
// title, so the brand is stated once), one specific line of what it is, three
// plain facts as a list, then the actions. Colour comes from the theme tokens
// alone - text-primary on the wordmark is the only accent.
//
// Every control works: Get started dismisses, View changelog closes this dialog
// and mounts the same ChangelogModal the header menu uses (as a sibling, so two
// overlays never stack) and Star on GitHub opens the repo. There is no opt-out:
// the dialog only appears right after a login. Modal renders its X on mobile
// only and this dialog sets
// closeOnOverlay={false}, so Get started is the desktop exit - it must stay.
// The header traffic lights are hidden too (showTrafficLights={false}): three
// dots whose first one closes a tour the user has not finished reading is a
// worse exit than the button that actually says what it does.
export default function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    if (localStorage.getItem("9router:welcomeNeverShow") === "true") {
      localStorage.removeItem("9router:welcomeNeverShow");
    }
    const justLoggedIn = sessionStorage.getItem("9router:justLoggedIn") === "true";

    if (!justLoggedIn) {
      setIsOpen(false);
    } else {
      sessionStorage.removeItem("9router:justLoggedIn");
      setIsOpen(true);
    }
  }, []);


  // Same endpoint the sidebar reads. Quiet failure: no chip is better than a
  // chip showing the wrong build.
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/version", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.currentVersion) setVersion(String(data.currentVersion));
      })
      .catch(() => {});
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
  };

  // No early `return null` here: the changelog mounts as a sibling below, and an
  // early return would unmount the whole fragment (changelog included) the moment
  // "View changelog" closes the welcome dialog. <Modal> already renders nothing
  // when isOpen is false, so passing it through is enough.
  if (!isOpen && !changelogOpen) return null;

  const facts = [
    "Manage and monitor all your AI connections and keys in one centralized dashboard.",
    "Stay updated with continuous improvements, fixes, and ecosystem enhancements.",
    "Inspect latest updates, changes, and release history directly in the changelog.",
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        closeOnOverlay={false}
        showTrafficLights={false}
        size="md"
        footer={null}
      >
        {/* Header: the product mark and wordmark stand in for the generic Modal
            title, so the brand is stated once instead of twice. */}
        <div className="flex items-center gap-3">
          <img
            src="/icons/icon-512.svg"
            alt=""
            width={44}
            height={44}
            className="size-11 rounded-xl border border-border-subtle"
          />
          <div>
            <p className="flex items-center gap-2 text-lg font-bold tracking-tight leading-tight text-primary">
              9Router
              {version && (
                <span className="rounded-md border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-normal text-text-muted">
                  v{version}
                </span>
              )}
            </p>
            <p className="text-xs text-text-muted">
              Welcome back to your unified gateway and management dashboard.
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-text-muted leading-relaxed">
          Centralized AI router and gateway. Seamlessly manage, configure, and monitor your AI infrastructure with zero lock-in.
        </p>

    {/* Plain facts, no cards: the dialog is the container, so the list does
        not need its own. */}
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-text-main marker:text-text-muted">
          {facts.map((fact) => (
            <li key={fact} className="leading-relaxed">
              {fact}
            </li>
          ))}
        </ul>

        {/* Actions. Get started dismisses; without it a desktop user has no way
            out (Modal renders its X on mobile only, overlay click is off). */}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            fullWidth
            className="sm:w-auto"
            onClick={handleClose}
          >
            Get started
          </Button>
          <Button
            variant="outline"
            fullWidth
            className="sm:w-auto"
            onClick={() => { setIsOpen(false); setChangelogOpen(true); }}
          >
            View changelog
          </Button>
          <a
            href={GITHUB_CONFIG.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-main transition-colors hover:border-primary hover:text-primary sm:w-auto"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Star on GitHub
          </a>
        </div>
      </Modal>
      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}