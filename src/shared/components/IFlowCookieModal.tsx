"use client";

import React, { useState } from "react";
import { Modal, Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";

interface IFlowCookieModalProps {
  isOpen: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
}

/**
 * iFlow Cookie Authentication Modal
 * User pastes browser cookie to get fresh API key
 */
export default function IFlowCookieModal({ isOpen, onSuccess, onClose }: IFlowCookieModalProps) {
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!cookie.trim()) {
      setError("Please paste your cookie");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/iflow/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err: any) {
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
    <Modal open={isOpen} onClose={handleClose} title="iFlow Cookie Authentication">
      <div className="space-y-4">
        {success ? (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-lg font-bold text-foreground">Authentication Successful!</p>
            <p className="text-xs text-muted-foreground mt-2 font-medium">Fresh API key obtained and stored.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">
                To get a fresh API key, paste your browser cookie from{" "}
                <a
                  href="https://platform.iflow.cn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-bold"
                >
                  platform.iflow.cn
                </a>
              </p>
              <div className="bg-muted/10 p-3 rounded-lg text-[10px] space-y-2 border border-border/50">
                <p className="font-bold text-foreground uppercase tracking-widest opacity-60">How to get cookie:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground font-medium">
                  <li>Open platform.iflow.cn in your browser</li>
                  <li>Login to your account</li>
                  <li>Open DevTools (F12) → Application/Storage → Cookies</li>
                  <li>Copy the entire cookie string (must include BXAuth)</li>
                  <li>Paste it below</li>
                </ol>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                Cookie String
              </label>
              <textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="BXAuth=xxx; ..."
                className="w-full px-3 py-2 bg-muted/5 border border-border/50 rounded-none text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 resize-none transition-colors"
                rows={4}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-xs font-bold uppercase tracking-wide text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={handleClose} disabled={loading} className="flex-1 h-10 font-bold text-xs uppercase tracking-widest border border-border/50 rounded-none">
                {translate("Cancel")}
              </Button>
              <Button onClick={handleSubmit} disabled={loading} className="flex-1 h-10 font-bold text-xs uppercase tracking-widest shadow-none">
                {loading ? "Authenticating..." : "Authenticate"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
