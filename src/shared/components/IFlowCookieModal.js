"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * iFlow Cookie Authentication Modal
 * User pastes browser cookie to get fresh API key
 */
import { i18nText } from "@/i18n/literals";
export default function IFlowCookieModal({ isOpen, onSuccess, onClose }) {
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const handleSubmit = async () => {
    if (!cookie.trim()) {
      setError(i18nText("Please paste your cookie"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/iflow/cookie", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cookie: cookie.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || i18nText("Authentication failed"));
      }
      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  const handleClose = () => {
    setCookie("");
    setError(null);
    setSuccess(false);
    onClose?.();
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={i18nText("iFlow Cookie Authentication")}
    >
      <div className="space-y-4">
        {success ? (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-lg font-medium text-text-primary">
              {i18nText("Authentication Successful!")}
            </p>
            <p className="text-sm text-text-muted mt-2">
              {i18nText("Fresh API key obtained")}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                {i18nText(
                  "To get a fresh API key, paste your browser cookie from",
                )}{" "}
                <a
                  href="https://platform.iflow.cn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  platform.iflow.cn
                </a>
              </p>
              <div className="bg-surface-secondary p-3 rounded-lg text-xs space-y-2">
                <p className="font-medium text-text-primary">
                  {i18nText("How to get cookie:")}
                </p>
                <ol className="list-decimal list-inside space-y-1 text-text-muted">
                  <li>{i18nText("Open platform.iflow.cn in your browser")}</li>
                  <li>{i18nText("Login to your account")}</li>
                  <li>
                    {i18nText(
                      "Open DevTools (F12) → Application/Storage → Cookies",
                    )}
                  </li>
                  <li>
                    {i18nText(
                      "Copy the entire cookie string (must include BXAuth)",
                    )}
                  </li>
                  <li>{i18nText("Paste it below")}</li>
                </ol>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-primary">
                {i18nText("Cookie String")}
              </label>
              <textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder={i18nText("BXAuth=xxx; ...")}
                className="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                rows={4}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="secondary"
                onClick={handleClose}
                disabled={loading}
                fullWidth
              >
                {i18nText("Cancel")}
              </Button>
              <Button onClick={handleSubmit} loading={loading} fullWidth>
                {i18nText("Authenticate")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
IFlowCookieModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};
