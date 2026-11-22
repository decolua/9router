"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Button from "./Button";
import ChangelogModal from "./ChangelogModal";
import { GITHUB_CONFIG } from "@/shared/constants/config";

// Post-login orientation follows the actual work in 9Router: build routes, then
// review what happened. The changelog stays a sibling so its dialog never stacks.
export default function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);

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

  const handleClose = () => {
    setIsOpen(false);
  };

  if (!isOpen && !changelogOpen) return null;

  const workAreas = [
    {
      label: "BUILD",
      description: "Connect providers and choose how requests reach a model.",
    },
    {
      label: "REVIEW",
      description: "Check usage, inspect logs, and follow request errors.",
    },
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Welcome to 9Router"
        closeOnOverlay={false}
        showTrafficLights={false}
        size="lg"
        footer={null}
        className="!border-2 !border-text-main !rounded-[3px] !shadow-[8px_8px_0_var(--neo-ink)]"
      >
        <section className="border-2 border-text-main bg-[#ffd45c] p-4 shadow-[4px_4px_0_var(--neo-ink)] sm:p-5">
          <img
            src="/icons/icon-512.svg"
            alt=""
            width={44}
            height={44}
            className="size-11 border-2 border-text-main bg-[#fffdf8] p-1"
          />
          <h2 className="mt-4 max-w-xl text-2xl font-black leading-tight tracking-tight text-text-main sm:text-3xl">
            Give each request a route you chose.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-main">
            Connect provider access, decide where requests should go, and see what happened from the same dashboard.
          </p>
        </section>

        <div className="mt-6">
          <ul className="divide-y-2 divide-border border-y-2 border-border">
            {workAreas.map((area) => (
              <li key={area.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-5">
                <span className="text-xs font-extrabold tracking-[0.08em] text-text-main sm:w-24 sm:shrink-0">
                  {area.label}
                </span>
                <p className="text-sm leading-relaxed text-text-muted">{area.description}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="primary"
            fullWidth
            className="w-full whitespace-nowrap"
            onClick={handleClose}
          >
            Open dashboard
          </Button>
          <Button
            variant="outline"
            fullWidth
            className="w-full whitespace-nowrap"
            onClick={() => { setIsOpen(false); setChangelogOpen(true); }}
          >
            Read changelog
          </Button>
          <a
            href={GITHUB_CONFIG.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-main transition-colors hover:border-primary hover:text-primary sm:col-span-2"
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
