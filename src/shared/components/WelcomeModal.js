"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";
import Button from "./Button";
import { GITHUB_CONFIG } from "@/shared/constants/config";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const { copied, copy } = useCopyToClipboard(2000);

  useEffect(() => {
    const neverShow = localStorage.getItem("9router:welcomeNeverShow") === "true";
    const justLoggedIn = sessionStorage.getItem("9router:justLoggedIn") === "true";

    if (neverShow || !justLoggedIn) {
      setIsOpen(false);
    } else {
      sessionStorage.removeItem("9router:justLoggedIn");
      setIsOpen(true);
    }

    fetch("/api/version")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.hasUpdate) {
          setUpdateInfo(data);
        }
      })
      .catch(() => {});
  }, []);

  const handleDontShowAgain = () => {
    localStorage.setItem("9router:welcomeNeverShow", "true");
    setIsOpen(false);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  if (!isOpen) return null;

  const installCmd = updateInfo?.installCmd || "npm i -g 9router@latest --prefer-online";

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

        {updateInfo && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
            <h3 className="font-semibold text-amber-500 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
              Update Available!
            </h3>
            <p className="text-text-muted text-xs">
              Your version is {updateInfo.behindBy} commit{updateInfo.behindBy > 1 ? "s" : ""} behind master.
            </p>
            {updateInfo.commitMessage && (
              <p className="text-xs text-text-main font-mono bg-bg/50 px-3 py-2 rounded-lg border border-border-subtle truncate">
                {updateInfo.commitMessage}
              </p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <code className="flex-1 text-xs font-mono bg-bg px-3 py-2 rounded-lg border border-border-subtle overflow-x-auto select-all">
                {installCmd}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(installCmd)}
                icon={copied ? "check" : "content_copy"}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
