"use client";

import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Lane confirmation for OpenCode Free.
 *
 * The hammer on the provider card is icon-only, so the choice it makes needs a
 * place to be explained: which lane is live now, what each lane actually does,
 * and an explicit confirm before the switch is written to settings.
 */
export default function OpenCodeLaneModal({ isOpen, cliMode, busy, onCancel, onConfirm }) {
  const nextIsCli = !cliMode;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="OpenCode Free lane"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Switching..." : nextIsCli ? "Switch to CLI" : "Switch to Direct"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Active lane</span>
          <span className="inline-flex items-center gap-1.5 rounded-[var(--r-chip)] border border-border/60 px-2 py-0.5 text-xs font-semibold text-text-main">
            <span className="material-symbols-outlined text-[14px]">handyman</span>
            {cliMode ? "CLI" : "Direct"}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <div
            className={`rounded-lg border px-3 py-2 ${
              cliMode ? "border-border/40 opacity-60" : "border-brand-500/40 bg-brand-500/5"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              Direct
              {!cliMode && <span className="text-[10px] font-medium text-brand-600 dark:text-brand-300">active</span>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Sends the request straight to opencode.ai with the Bun-shaped TLS fingerprint.
              Works on any host — no CLI, no proxy, no sidecar. Fastest path.
            </p>
          </div>

          <div
            className={`rounded-lg border px-3 py-2 ${
              cliMode ? "border-brand-500/40 bg-brand-500/5" : "border-border/40 opacity-60"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <span className="material-symbols-outlined text-[16px]">terminal</span>
              CLI
              {cliMode && <span className="text-[10px] font-medium text-brand-600 dark:text-brand-300">active</span>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Runs the local <code className="text-text-main">opencode</code> CLI first, then a Bun
              transport sidecar and an egress probe. Only works where the CLI is installed, and it
              adds several seconds per request.
            </p>
          </div>
        </div>

        <p className="text-xs text-text-muted">
          Switching applies to every request that uses this provider, for all clients.
        </p>
      </div>
    </Modal>
  );
}

OpenCodeLaneModal.propTypes = {
  isOpen: PropTypes.bool,
  cliMode: PropTypes.bool,
  busy: PropTypes.bool,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};
