"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

export default function CodeBuddyQuotaCookieModal({ isOpen, connectionIds, onSuccess, onClose }) {
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!cookie.trim()) {
      setError("Paste your CodeBuddy web cookie first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/oauth/codebuddy/quota-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cookie: cookie.trim(),
          connectionIds,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Failed to save CodeBuddy quota cookie.");
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 900);
    } catch (err) {
      setError(err.message || "Failed to save CodeBuddy quota cookie.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCookie("");
    setError("");
    setSuccess(false);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="CodeBuddy Quota Cookie">
      <div className="space-y-4">
        {success ? (
          <div className="py-6 text-center">
            <p className="text-lg font-medium text-text-primary">Quota cookie saved.</p>
            <p className="mt-2 text-sm text-text-muted">Quota Tracker can now read CodeBuddy credits for the selected connection.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2 text-sm text-text-muted">
              <p>
                Paste the cookie string from a logged-in CodeBuddy web session. This is only used for the quota endpoint; your existing OAuth token still handles chat.
              </p>
              <div className="rounded-lg bg-surface-secondary p-3 text-xs">
                Open codebuddy.ai, sign in, then copy the request cookie from DevTools Network for a request to codebuddy.ai.
              </div>
            </div>

            <textarea
              value={cookie}
              onChange={(event) => setCookie(event.target.value)}
              placeholder="session=...; AUTH_SESSION_ID=...; ..."
              className="h-28 w-full resize-none rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={loading}
            />

            {error && (
              <div className="rounded-lg border border-error/20 bg-error/10 p-3">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={handleClose} disabled={loading} fullWidth>
                Cancel
              </Button>
              <Button onClick={handleSubmit} loading={loading} fullWidth>
                Save Cookie
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

CodeBuddyQuotaCookieModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connectionIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};
