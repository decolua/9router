"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

export default function AddCodexGoModal({ isOpen, onClose, onSuccess }) {
  const [integrationToken, setIntegrationToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleClose = () => {
    if (submitting) return;
    setIntegrationToken("");
    setDisplayName("");
    setError("");
    setSuccess(false);
    onClose?.();
  };

  const handleSubmit = async () => {
    const token = integrationToken.trim();
    if (!token) {
      setError(translate("Integration token is required"));
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const response = await fetch("/api/oauth/codex/import-codexgo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationToken: token,
          ...(displayName.trim() ? { name: displayName.trim() } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Request failed: ${response.status}`);
      }

      setSuccess(true);
      onSuccess?.();
      window.setTimeout(handleClose, 700);
    } catch (err) {
      setError(err.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title={translate("Add CodexGo")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        {success ? (
          <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-500">
            {translate("CodexGo account added.")}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">
                {translate("Integration token")}
              </label>
              <input
                type="password"
                className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={translate("Paste CodexGo integration token")}
                value={integrationToken}
                onChange={(event) => setIntegrationToken(event.target.value)}
                disabled={submitting}
                autoComplete="off"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">
                {translate("Display name")}
              </label>
              <input
                type="text"
                className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={translate("Optional")}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-error/20 bg-error/10 p-3">
                <p className="text-sm text-error break-words">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleSubmit}
                fullWidth
                loading={submitting}
                disabled={!integrationToken.trim()}
              >
                {submitting ? translate("Importing...") : translate("Add CodexGo")}
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
                {translate("Close")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

AddCodexGoModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
