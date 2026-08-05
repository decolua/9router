"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * Zed Hosted AI Auth Modal
 * Auto-detect and/or manually import user_id + access_token from Zed Editor.
 */
export default function ZedAuthModal({ isOpen, onSuccess, onClose }) {
  const [userId, setUserId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [manualHint, setManualHint] = useState(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setError(null);
    setAutoDetected(false);
    setManualHint(false);

    try {
      const res = await fetch("/api/oauth/zed/auto-import");
      const data = await res.json();

      if (data.found) {
        setUserId(data.userId || "");
        setAccessToken(data.accessToken || "");
        setAutoDetected(true);
      } else if (data.windowsManual) {
        setManualHint(true);
      } else {
        setError(data.error || "Could not auto-detect Zed credentials");
      }
    } catch {
      setError("Failed to auto-detect credentials");
    } finally {
      setAutoDetecting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    runAutoDetect();
  }, [isOpen]);

  const handleImportToken = async () => {
    let uid = userId.trim();
    let token = accessToken.trim();

    // Allow pasting "user_id access_token" or a callback URL into the token field.
    if ((!uid || !token) && token) {
      try {
        const url = new URL(token.startsWith("http") || token.startsWith("/") ? token : `http://127.0.0.1/?${token.replace(/^\?/, "")}`, "http://127.0.0.1");
        uid = uid || url.searchParams.get("user_id") || "";
        token = url.searchParams.get("access_token") || token;
      } catch {
        /* ignore */
      }
    }
    if (!uid && token.includes(" ")) {
      const idx = token.indexOf(" ");
      uid = token.slice(0, idx).trim();
      token = token.slice(idx + 1).trim();
    }

    if (!uid) {
      setError("Please enter a user ID");
      return;
    }
    if (!token) {
      setError("Please enter an access token");
      return;
    }

    // Encrypted native-app callback tokens need the RSA private key — reject clearly.
    if (token.includes("==") && token.length > 200 && !token.trimStart().startsWith("{")) {
      setError(
        "That looks like an encrypted browser-callback token. Use “Sign in with browser”, or paste the plain Zed access token (Authorization: \"{user_id} {access_token}\").",
      );
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/zed/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: uid,
          accessToken: token,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Zed Hosted AI" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {autoDetecting && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto-detecting credentials...</h3>
            <p className="text-sm text-text-muted">
              Looking for Zed Editor credentials
            </p>
          </div>
        )}

        {!autoDetecting && (
          <>
            {autoDetected && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Credentials auto-detected from Zed successfully!
                  </p>
                </div>
              </div>
            )}

            {manualHint && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">info</span>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Could not read Zed credentials automatically.
                  </p>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Paste your Zed <strong>user ID</strong> and <strong>access token</strong> below
                  (Authorization format: <code>{"{user_id} {access_token}"}</code>).
                </p>
                <Button onClick={runAutoDetect} variant="outline" fullWidth>
                  Retry
                </Button>
              </div>
            )}

            {!autoDetected && !manualHint && !error && (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Zed credentials not detected. Paste your user ID and access token manually.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">
                User ID <span className="text-red-500">*</span>
              </label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Numeric Zed user id"
                className="font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Access Token <span className="text-red-500">*</span>
              </label>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder='Plain token, JSON keyring blob, or "user_id access_token"'
                rows={3}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
              />
              <p className="text-xs text-text-muted mt-1">
                Plain access token from Zed (not the encrypted browser-callback URL).
                You can also paste <code className="text-[11px]">user_id access_token</code> into this field.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || (!userId.trim() && !accessToken.trim())}
              >
                {importing ? "Importing..." : "Import Credentials"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

ZedAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
