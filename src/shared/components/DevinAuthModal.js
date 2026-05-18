"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

const SHOW_AUTH_TOKEN_URL =
  "https://windsurf.com/windsurf/signin?response_type=token" +
  "&client_id=3GUryQ7ldAeKEuD2obYnppsnmj58eP5u" +
  "&redirect_uri=show-auth-token" +
  "&prompt=login&redirect_parameters_type=query&workflow=";

export default function DevinAuthModal({ isOpen, onSuccess, onClose }) {
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setSelectedMethod(null);
    setToken("");
    setError(null);
    setImporting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleBack = () => {
    setToken("");
    setError(null);
    setSelectedMethod(null);
  };

  const submitImport = async ({ url, payloadKey }) => {
    if (!token.trim()) {
      setError("Please paste the token");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [payloadKey]: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      onSuccess?.();
      reset();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleSessionImport = () =>
    submitImport({ url: "/api/oauth/devin/import", payloadKey: "apiKey" });

  const handleAuthTokenImport = () =>
    submitImport({ url: "/api/oauth/devin/import-auth-token", payloadKey: "authToken" });

  const openShowAuthToken = () => {
    if (typeof window !== "undefined") window.open(SHOW_AUTH_TOKEN_URL, "_blank");
  };

  return (
    <Modal isOpen={isOpen} title="Connect Devin AI" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {!selectedMethod && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted mb-4">
              Choose your authentication method:
            </p>

            <button
              onClick={() => setSelectedMethod("auth-token")}
              className="w-full p-4 text-left border border-border rounded-lg hover:bg-sidebar transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">key</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Windsurf Auth Token</h3>
                  <p className="text-sm text-text-muted">
                    Recommended. Sign in at windsurf.com/show-auth-token and paste the token.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setSelectedMethod("session")}
              className="w-full p-4 text-left border border-border rounded-lg hover:bg-sidebar transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">file_upload</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Devin Session Token</h3>
                  <p className="text-sm text-text-muted">
                    Paste a <code>devin-session-token$…</code> JWT (e.g. from <code>devin auth login</code>).
                  </p>
                </div>
              </div>
            </button>
          </div>
        )}

        {selectedMethod === "auth-token" && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p>Sign in to Windsurf, then copy the token shown on the redirect page.</p>
                  <p className="mt-1 text-xs opacity-80">
                    The token is exchanged server-side for a Devin session token.
                  </p>
                </div>
              </div>
            </div>

            <Button onClick={openShowAuthToken} variant="ghost" fullWidth>
              Open windsurf.com/show-auth-token
            </Button>

            <div>
              <label className="block text-sm font-medium mb-2">
                Auth Token <span className="text-red-500">*</span>
              </label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the token from windsurf.com/show-auth-token..."
                className="font-mono text-sm"
                type="password"
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleAuthTokenImport}
                fullWidth
                disabled={importing || !token.trim()}
              >
                {importing ? "Connecting..." : "Connect"}
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {selectedMethod === "session" && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p>
                    Paste a token starting with <code>devin-session-token$</code>. Run{" "}
                    <code>devin auth login</code> in the CLI to obtain one.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Devin Session Token <span className="text-red-500">*</span>
              </label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="devin-session-token$..."
                className="font-mono text-sm"
                type="password"
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleSessionImport}
                fullWidth
                disabled={importing || !token.trim()}
              >
                {importing ? "Connecting..." : "Connect"}
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

DevinAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
