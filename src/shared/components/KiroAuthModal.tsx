"use client";

import React, { useState, useEffect } from "react";
import { Modal, Button, Input } from "@/shared/components";
import { 
  ShieldCheck, 
  Storefront as Business, 
  UserCircle as AccountCircle, 
  Code, 
  UploadSimple as FileUpload,
  WarningCircle,
  CheckCircle,
  Info
} from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";

interface KiroAuthModalProps {
  isOpen: boolean;
  onMethodSelect: (method: string, config?: any) => void;
  onClose: () => void;
}

/**
 * Kiro Auth Method Selection Modal
 * Auto-detects token from AWS SSO cache or allows manual import
 */
export default function KiroAuthModal({ isOpen, onMethodSelect, onClose }: KiroAuthModalProps) {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [idcStartUrl, setIdcStartUrl] = useState("");
  const [idcRegion, setIdcRegion] = useState("us-east-1");
  const [refreshToken, setRefreshToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  // Auto-detect token when import method is selected
  useEffect(() => {
    if (selectedMethod !== "import" || !isOpen) return;

    const autoDetect = async () => {
      setAutoDetecting(true);
      setError(null);
      setAutoDetected(false);

      try {
        const res = await fetch("/api/oauth/kiro/auto-import");
        const data = await res.json();

        if (data.found) {
          setRefreshToken(data.refreshToken);
          setAutoDetected(true);
        } else {
          setError(data.error || "Could not auto-detect token");
        }
      } catch (err) {
        setError("Failed to auto-detect token");
      } finally {
        setAutoDetecting(false);
      }
    };

    autoDetect();
  }, [selectedMethod, isOpen]);

  const handleMethodSelect = (method: string) => {
    setSelectedMethod(method);
    setError(null);
  };

  const handleBack = () => {
    setSelectedMethod(null);
    setError(null);
  };

  const handleImportToken = async () => {
    if (!refreshToken.trim()) {
      setError("Please enter a refresh token");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshToken.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Success - notify parent to refresh connections
      onMethodSelect("import");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleIdcContinue = () => {
    if (!idcStartUrl.trim()) {
      setError("Please enter your IDC start URL");
      return;
    }
    onMethodSelect("idc", { startUrl: idcStartUrl.trim(), region: idcRegion });
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSocialLogin = (provider: string) => {
    onMethodSelect("social", { provider });
  };

  return (
    <Modal open={isOpen} title="Connect Kiro" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Method Selection */}
        {!selectedMethod && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-4 font-medium">
              Choose your authentication method:
            </p>

            {/* AWS Builder ID */}
            <button
              onClick={() => onMethodSelect("builder-id")}
              className="w-full p-4 text-left border border-border/50 rounded-lg bg-muted/5 hover:bg-muted/10 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <ShieldCheck className="size-5 text-primary mt-0.5 group-hover:scale-110 transition-transform" weight="bold" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 text-sm tracking-tight text-foreground">AWS Builder ID</h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    Recommended for most users. Free AWS account required.
                  </p>
                </div>
              </div>
            </button>

            {/* AWS IAM Identity Center (IDC) */}
            <button
              onClick={() => handleMethodSelect("idc")}
              className="w-full p-4 text-left border border-border/50 rounded-lg bg-muted/5 hover:bg-muted/10 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <Business className="size-5 text-primary mt-0.5 group-hover:scale-110 transition-transform" weight="bold" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 text-sm tracking-tight text-foreground">AWS IAM Identity Center</h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    For enterprise users with custom AWS IAM Identity Center.
                  </p>
                </div>
              </div>
            </button>

            {/* Google Social Login - HIDDEN */}
            <button
              onClick={() => handleMethodSelect("social-google")}
              className="hidden w-full p-4 text-left border border-border/50 rounded-lg bg-muted/5 hover:bg-muted/10 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <AccountCircle className="size-5 text-primary mt-0.5" weight="bold" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 text-sm tracking-tight">Google Account</h3>
                  <p className="text-xs text-muted-foreground">
                    Login with your Google account (manual callback).
                  </p>
                </div>
              </div>
            </button>

            {/* GitHub Social Login - HIDDEN */}
            <button
              onClick={() => handleMethodSelect("social-github")}
              className="hidden w-full p-4 text-left border border-border/50 rounded-lg bg-muted/5 hover:bg-muted/10 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <Code className="size-5 text-primary mt-0.5" weight="bold" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 text-sm tracking-tight">GitHub Account</h3>
                  <p className="text-xs text-muted-foreground">
                    Login with your GitHub account (manual callback).
                  </p>
                </div>
              </div>
            </button>

            {/* Import Token */}
            <button
              onClick={() => handleMethodSelect("import")}
              className="w-full p-4 text-left border border-border/50 rounded-lg bg-muted/5 hover:bg-muted/10 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <FileUpload className="size-5 text-primary mt-0.5 group-hover:scale-110 transition-transform" weight="bold" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-1 text-sm tracking-tight text-foreground">Import Token</h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    Paste refresh token from Kiro IDE.
                  </p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* IDC Configuration */}
        {selectedMethod === "idc" && (
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                IDC Start URL <span className="text-destructive">*</span>
              </label>
              <Input
                value={idcStartUrl}
                onChange={(e) => setIdcStartUrl(e.target.value)}
                placeholder="https://your-org.awsapps.com/start"
                className="font-mono text-xs h-10 bg-muted/5 border-border/50"
              />
              <p className="text-[10px] text-muted-foreground font-medium italic opacity-70 px-1">
                Your organization&apos;s AWS IAM Identity Center URL
              </p>
            </div>

            <div className="grid gap-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                AWS Region
              </label>
              <Input
                value={idcRegion}
                onChange={(e) => setIdcRegion(e.target.value)}
                placeholder="us-east-1"
                className="font-mono text-xs h-10 bg-muted/5 border-border/50"
              />
            </div>

            {error && (
              <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20 flex items-center gap-2">
                <WarningCircle className="size-4 text-destructive" weight="bold" />
                <p className="text-xs font-bold uppercase tracking-wide text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleIdcContinue} className="flex-1 h-10 font-bold text-xs uppercase tracking-widest" disabled={!idcStartUrl.trim()}>
                Continue
              </Button>
              <Button onClick={handleBack} variant="ghost" className="flex-1 h-10 font-bold text-xs uppercase tracking-widest border border-border/50">
                Back
              </Button>
            </div>
          </div>
        )}

        {/* Token Import */}
        {selectedMethod === "import" && (
          <div className="space-y-4">
            {autoDetecting ? (
              <div className="text-center py-6 flex flex-col items-center gap-3">
                <span className="material-symbols-outlined text-4xl text-primary animate-spin">
                  progress_activity
                </span>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Auto-detecting AWS credentials...</p>
              </div>
            ) : (
              <>
                {/* Success message if auto-detected */}
                {autoDetected && (
                  <div className="bg-primary/10 p-3 rounded-lg border border-primary/20 flex items-center gap-2">
                    <CheckCircle className="size-4 text-primary" weight="bold" />
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">
                      Token auto-detected from Kiro IDE successfully!
                    </p>
                  </div>
                )}

                {/* Info message if not auto-detected */}
                {!autoDetected && !error && (
                  <div className="bg-muted/10 p-3 rounded-lg border border-border/50 flex items-center gap-2">
                    <Info className="size-4 text-muted-foreground" weight="bold" />
                    <p className="text-xs font-medium text-muted-foreground">
                      Kiro IDE not detected. Please paste your refresh token manually.
                    </p>
                  </div>
                )}

                <div className="grid gap-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-1">
                    Refresh Token <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={refreshToken}
                    onChange={(e) => setRefreshToken(e.target.value)}
                    placeholder="Token will be auto-filled..."
                    className="font-mono text-xs h-10 bg-muted/5 border-border/50"
                  />
                </div>

                {error && (
                  <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20 flex items-center gap-2">
                    <WarningCircle className="size-4 text-destructive" weight="bold" />
                    <p className="text-xs font-bold uppercase tracking-wide text-destructive">{error}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button onClick={handleImportToken} className="flex-1 h-10 font-bold text-xs uppercase tracking-widest" disabled={importing || !refreshToken.trim()}>
                    {importing ? "Importing..." : "Import Token"}
                  </Button>
                  <Button onClick={handleBack} variant="ghost" className="flex-1 h-10 font-bold text-xs uppercase tracking-widest border border-border/50">
                    Back
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
