"use client";

import React, { useState, useEffect } from "react";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { translate } from "@/i18n/runtime";

interface KiroSocialOAuthModalProps {
  isOpen: boolean;
  provider: "google" | "github";
  onSuccess?: () => void;
  onClose: () => void;
}

/**
 * Kiro Social OAuth Modal (Google/GitHub)
 * Handles manual callback URL flow for social login
 */
export default function KiroSocialOAuthModal({ isOpen, provider, onSuccess, onClose }: KiroSocialOAuthModalProps) {
  const [step, setStep] = useState<"loading" | "input" | "success" | "error">("loading");
  const [authUrl, setAuthUrl] = useState("");
  const [authData, setAuthData] = useState<any>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  // Initialize auth flow
  useEffect(() => {
    if (!isOpen || !provider) return;

    const initAuth = async () => {
      try {
        setError(null);
        setStep("loading");

        const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error);
        }

        setAuthData(data);
        setAuthUrl(data.authUrl);
        setStep("input");

        // Auto-open browser
        window.open(data.authUrl, "_blank");
      } catch (err: any) {
        setError(err.message);
        setStep("error");
      }
    };

    initAuth();
  }, [isOpen, provider]);

  const handleManualSubmit = async () => {
    try {
      setError(null);
      
      // Parse callback URL - can be either kiro:// or http://localhost format
      let url;
      try {
        url = new URL(callbackUrl);
      } catch (e) {
        // If URL parsing fails, might be malformed
        throw new Error("Invalid callback URL format");
      }

      const code = url.searchParams.get("code");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        throw new Error(url.searchParams.get("error_description") || errorParam);
      }

      if (!code) {
        throw new Error("No authorization code found in URL");
      }

      // Exchange code for tokens
      const res = await fetch("/api/oauth/kiro/social-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          codeVerifier: authData.codeVerifier,
          provider,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccess?.();
    } catch (err: any) {
      setError(err.message);
      setStep("error");
    }
  };

  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Modal open={isOpen} title={`Connect Kiro via ${providerName}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Loading */}
        {step === "loading" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Initializing...</h3>
            <p className="text-sm text-muted-foreground">
              Setting up {providerName} authentication
            </p>
          </div>
        )}

        {/* Manual Input Step */}
        {step === "input" && (
          <>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <Input value={authUrl} readOnly className="flex-1 font-mono text-xs h-10 bg-muted/5 border-border/50" />
                  <Button 
                    variant="secondary" 
                    onClick={() => copy(authUrl, "auth_url")}
                    className="h-10 px-4 text-xs font-bold uppercase tracking-wider shrink-0"
                  >
                    {copied === "auth_url" ? "check" : "content_copy"}
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Step 2: Paste the callback URL here</p>
                <p className="text-[10px] text-muted-foreground mb-2 font-medium">
                  After authorization, copy the full URL from your browser address bar.
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="kiro://kiro.kiroAgent/authenticate-success?code=..."
                  className="font-mono text-xs h-10 bg-muted/5 border-border/50"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleManualSubmit} className="flex-1 h-10 font-bold text-xs uppercase tracking-widest" disabled={!callbackUrl}>
                Connect
              </Button>
              <Button onClick={onClose} variant="ghost" className="flex-1 h-10 font-bold text-xs uppercase tracking-widest border border-border/50">
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Your Kiro account via {providerName} has been connected.
            </p>
            <Button onClick={onClose} className="w-full h-10 font-bold text-xs uppercase tracking-widest shadow-none">
              Done
            </Button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-xs font-bold uppercase tracking-wide text-red-600 mb-6">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => setStep("input")} variant="secondary" className="flex-1 h-10 font-bold text-xs uppercase tracking-widest">
                Try Again
              </Button>
              <Button onClick={onClose} variant="ghost" className="flex-1 h-10 font-bold text-xs uppercase tracking-widest border border-border/50">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
