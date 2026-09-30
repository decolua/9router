"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Button from "./Button";
import { GITHUB_CONFIG } from "@/shared/constants/config";

// Update notices live in their own banner, so this dialog stays about the repo.
export default function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const neverShow = localStorage.getItem("9router:welcomeNeverShow") === "true";
    const justLoggedIn = sessionStorage.getItem("9router:justLoggedIn") === "true";

    if (neverShow || !justLoggedIn) {
      setIsOpen(false);
    } else {
      sessionStorage.removeItem("9router:justLoggedIn");
      setIsOpen(true);
    }
  }, []);

  const handleDontShowAgain = () => {
    localStorage.setItem("9router:welcomeNeverShow", "true");
    setIsOpen(false);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      closeOnOverlay={false}
      title="Welcome to 9Router!"
      size="md"
      footer={null}
    >
      <div className="space-y-6 text-text-main text-sm">
        <div className="flex flex-col items-center justify-center text-center p-6 bg-surface-2 rounded-xl border border-border-subtle gap-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[32px]">hub</span>
          </div>
          <p className="text-base font-medium">
            Thank you for using 9Router!
          </p>
          <p className="text-text-muted text-xs px-4">
            If you find this project helpful, please support us by starring our repository on GitHub.
          </p>
          <a
            href={GITHUB_CONFIG.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2"
          >
            <Button variant="primary" icon="star">
              Star on GitHub
            </Button>
          </a>
        </div>
      </div>
    </Modal>
  );
}
