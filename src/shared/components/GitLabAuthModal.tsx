"use client";

import React, { useState } from "react";
import { Modal, Button, Input, OAuthModal } from "@/shared/components";
import { LockOpen, Key } from "@phosphor-icons/react";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";

const GITLAB_COM = "https://gitlab.com";

function getRedirectUri() {
  if (typeof window === "undefined") return "http://localhost/callback";
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return `http://localhost:${port}/callback`;
}

interface ProviderInfo {
  name: string;
}

interface GitLabAuthModalProps {
  isOpen: boolean;
  providerInfo: ProviderInfo;
  onSuccess?: () => void;
  onClose: () => void;
}

/**
 * GitLab Duo Authentication Modal
 * Supports two modes:
 * - OAuth (PKCE): requires OAuth App Client ID (and optional Client Secret)
 * - PAT: requires Personal Access Token
 */
export default function GitLabAuthModal({ isOpen, providerInfo, onSuccess, onClose }: GitLabAuthModalProps) {
  const [mode, setMode] = useState<"oauth" | "pat" | null>(null);
  const [baseUrl, setBaseUrl] = useState(GITLAB_COM);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOAuth, setShowOAuth] = useState(false);
  const [oauthMeta, setOauthMeta] = useState<any>(null);

  const reset = () => {
    setMode(null);
    setBaseUrl(GITLAB_COM);
    setClientId("");
    setClientSecret("");
    setPat("");
    setError(null);
    setLoading(false);
    setShowOAuth(false);
    setOauthMeta(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleOAuthStart = () => {
    if (!clientId.trim()) {
      setError(translate("Client ID is required"));
      return;
    }
    setError(null);
    setOauthMeta({ baseUrl: baseUrl.trim() || GITLAB_COM, clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    setShowOAuth(true);
  };

  const handlePATSubmit = async () => {
    if (!pat.trim()) {
      setError(translate("Personal Access Token is required"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/gitlab/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat.trim(), baseUrl: baseUrl.trim() || GITLAB_COM }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || translate("Authentication failed"));
      onSuccess?.();
      handleClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Sub-modal for OAuth PKCE flow
  if (showOAuth && oauthMeta) {
    return (
      <OAuthModal
        open={true}
        provider="gitlab"
        providerInfo={providerInfo}
        oauthMeta={oauthMeta}
        onSuccess={() => { onSuccess?.(); handleClose(); }}
        onClose={() => { setShowOAuth(false); setOauthMeta(null); }}
      />
    );
  }

  return (
    <Modal open={isOpen} title={translate("Connect GitLab Duo")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        {/* Mode selection */}
        {!mode && (
          <>
            <p className="text-sm text-muted-foreground font-medium">
              {translate("Choose how to authenticate with GitLab Duo:")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode("oauth")}
                className="flex flex-col items-center gap-3 p-5 rounded-lg border border-border/50 bg-muted/5 hover:border-primary/50 hover:bg-primary/5 transition-colors text-left group"
              >
                <LockOpen className="size-8 text-primary group-hover:scale-110 transition-transform" weight="bold" />
                <div className="text-center">
                  <p className="text-sm font-bold tracking-tight">{translate("OAuth App")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{translate("Use a GitLab App")}</p>
                </div>
              </button>
              <button
                onClick={() => setMode("pat")}
                className="flex flex-col items-center gap-3 p-5 rounded-lg border border-border/50 bg-muted/5 hover:border-primary/50 hover:bg-primary/5 transition-colors text-left group"
              >
                <Key className="size-8 text-primary group-hover:scale-110 transition-transform" weight="bold" />
                <div className="text-center">
                  <p className="text-sm font-bold tracking-tight">{translate("Access Token")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{translate("Use a GitLab PAT")}</p>
                </div>
              </button>
            </div>
          </>
        )}

        {/* OAuth mode */}
        {mode === "oauth" && (
          <div className="space-y-4">
            <p className="px-1 text-xs text-muted-foreground leading-relaxed">
              {translate("Create an OAuth app at")} {" "}
              <a href={`${baseUrl.trim() || GITLAB_COM}/-/profile/applications`} target="_blank" rel="noreferrer" className="text-primary underline font-bold">
                {translate("GitLab Applications")}
              </a>{" "}
              {translate("with redirect URI")} {" "}
              <code className="bg-muted px-1 rounded-none font-mono text-[10px]">{getRedirectUri()}</code>
            </p>
            <div className="grid gap-2">
               <Label className="px-1 text-xs text-muted-foreground">{translate("GitLab Base URL")}</Label>
               <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} className="rounded-none border-border/50 bg-muted/5 h-9 text-xs" />
            </div>
            <div className="grid gap-2">
               <Label className="px-1 text-xs text-muted-foreground">{translate("Client ID")}</Label>
               <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={translate("Your application ID")} className="rounded-none border-border/50 bg-muted/5 h-9 text-xs" />
            </div>
            <div className="grid gap-2">
               <Label className="px-1 text-xs text-muted-foreground">{translate("Client Secret (optional)")}</Label>
               <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={translate("PKCE only")} className="rounded-none border-border/50 bg-muted/5 h-9 text-xs" />
            </div>
            {error && <p className="px-1 text-xs font-medium text-destructive">{translate(error)}</p>}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleOAuthStart} className="flex-1 h-10 text-xs font-medium" disabled={!clientId.trim()}>
                {translate("Authorize")}
              </Button>
              <Button onClick={() => { setMode(null); setError(null); }} variant="ghost" className="flex-1 h-10 border border-border/50 rounded-none text-xs font-medium">
                {translate("Back")}
              </Button>
            </div>
          </div>
        )}

        {/* PAT mode */}
        {mode === "pat" && (
          <div className="space-y-4">
            <p className="px-1 text-xs text-muted-foreground leading-relaxed">
              {translate("Create a PAT at")} {" "}
              <a href={`${baseUrl.trim() || GITLAB_COM}/-/user_settings/personal_access_tokens`} target="_blank" rel="noreferrer" className="text-primary underline font-bold">
                {translate("GitLab Access Tokens")}
              </a>{" "}
              {translate("with scopes:")} <code className="bg-muted px-1 rounded-none font-mono text-[10px]">api</code>,{" "}
              <code className="bg-muted px-1 rounded-none font-mono text-[10px]">read_user</code>, {translate("and")} {" "}
              <code className="bg-muted px-1 rounded-none font-mono text-[10px]">ai_features</code>.
            </p>
            <div className="grid gap-2">
               <Label className="px-1 text-xs text-muted-foreground">{translate("GitLab Base URL")}</Label>
               <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} className="rounded-none border-border/50 bg-muted/5 h-9 text-xs" />
            </div>
            <div className="grid gap-2">
               <Label className="px-1 text-xs text-muted-foreground">{translate("Personal Access Token")}</Label>
               <Input value={pat} onChange={(e) => setPat(e.target.value)} placeholder={translate("glpat-xxxxxxxxxxxxxxxxxxxx")} type="password" className="rounded-none border-border/50 bg-muted/5 h-9 text-xs" />
            </div>
            {error && <p className="px-1 text-xs font-medium text-destructive">{translate(error)}</p>}
            <div className="flex gap-2 pt-2">
              <Button onClick={handlePATSubmit} className="flex-1 h-10 text-xs font-medium" disabled={!pat.trim() || loading}>
                {loading ? translate("Connecting...") : translate("Connect")}
              </Button>
              <Button onClick={() => { setMode(null); setError(null); }} variant="ghost" className="flex-1 h-10 border border-border/50 rounded-none text-xs font-medium">
                {translate("Back")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
