"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { KIRO_EXTERNAL_IDP_DEFAULTS } from "@/lib/oauth/constants/oauth";

/**
 * External IdP (Microsoft Entra ID / Azure AD) auth form for Kiro.
 *
 * Flow:
 *  1. User enters issuerUrl, clientId, scopes (pre-filled with sensible defaults).
 *  2. Click "Sign in with Microsoft" → client generates PKCE → POST /authorize.
 *  3. /authorize spawns the loopback capture server and returns the authUrl.
 *  4. window.open(authUrl) launches the user's browser at Microsoft.
 *  5. UI polls /authorize?state=... every 1.5s until the loopback captures
 *     the redirect. The user sees a "Waiting for Microsoft…" status.
 *  6. On capture, POST /exchange with the code + verifier. On success the
 *     modal closes and `onSuccess(connection)` runs.
 *
 * Fallback: if `portInUse` is returned by /authorize (Kiro IDE already
 * bound localhost:3128), the user can paste the full redirect URL into the
 * form and submit. The exchange route accepts the URL or the raw code.
 */

// Browser-safe PKCE helpers — use Web Crypto because Node crypto is not
// available in client components.
async function generateClientCodeVerifier(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}

async function generateClientCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractCodeFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    return { code, state };
  } catch {
    return null;
  }
}

export default function ExternalIdpAuthForm({ isOpen, onSuccess, onClose }) {
  const [step, setStep] = useState("input"); // input | authorizing | waiting | exchanging | error | success
  const [issuerUrl, setIssuerUrl] = useState("https://login.microsoftonline.com/common/v2.0");
  const [clientId, setClientId] = useState("");
  const [scopes, setScopes] = useState(KIRO_EXTERNAL_IDP_DEFAULTS.scopes);
  const [region, setRegion] = useState("us-east-1");
  const [manualUrl, setManualUrl] = useState("");
  const [error, setError] = useState(null);
  const [portInUse, setPortInUse] = useState(false);
  const [stateRef, setStateRef] = useState(null);
  const [verifierRef, setVerifierRef] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes/reopens so we don't leak a pending flow.
      setStep("input");
      setError(null);
      setPortInUse(false);
      setStateRef(null);
      setVerifierRef(null);
      setManualUrl("");
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [isOpen]);

  async function handleSignIn() {
    setError(null);
    setStep("authorizing");
    try {
      const codeVerifier = await generateClientCodeVerifier();
      setVerifierRef(codeVerifier);
      const codeChallenge = await generateClientCodeChallenge(codeVerifier);

      const res = await fetch("/api/oauth/kiro/external-idp/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuerUrl,
          clientId,
          scopes,
          codeVerifier,
          region,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Authorize failed (${res.status})`);
      }
      setStateRef(data.state);
      setPortInUse(Boolean(data.portInUse));

      // Open Microsoft login in a new tab. The user authenticates and is
      // redirected to localhost:3128/oauth/callback where our loopback server
      // captures the code.
      const popup = window.open(data.authUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        setError(
          "Popup blocked. Allow popups for 9router, then click Sign in again. " +
          "Alternatively paste the redirect URL below."
        );
        setStep("input");
        return;
      }

      if (data.portInUse) {
        // Port 3128 is taken (likely by Kiro IDE). The redirect won't auto-
        // capture, so the user must paste the URL manually.
        setError(
          "Loopback port 3128 is already in use (probably by Kiro IDE). " +
          "Complete sign-in in your browser, then paste the redirect URL below."
        );
        setStep("input");
        return;
      }

      setStep("waiting");
      pollRef.current = setInterval(() => pollCapture(data.state), 1500);
    } catch (err) {
      setError(err.message || "Failed to start sign-in");
      setStep("input");
    }
  }

  async function pollCapture(state) {
    try {
      const res = await fetch(`/api/oauth/kiro/external-idp/authorize?state=${encodeURIComponent(state)}`);
      const data = await res.json();
      if (data.status === "captured") {
        clearInterval(pollRef.current);
        pollRef.current = null;
        await runExchange({ code: data.code, state: data.state });
      } else if (data.status === "expired" || data.status === "error") {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setError(
          (data && data.error) ||
          "Sign-in window expired or failed. Click Sign in with Microsoft to try again."
        );
        setStep("input");
      }
      // "pending" → keep polling
    } catch (err) {
      // Network blip; let the next tick handle it.
    }
  }

  async function handleManualSubmit() {
    setError(null);
    const parsed = extractCodeFromUrl(manualUrl);
    if (!parsed || !parsed.code) {
      setError("Paste the full redirect URL (starting with http://localhost:3128/oauth/callback?code=…)");
      return;
    }
    if (!stateRef || !verifierRef) {
      setError("Restart sign-in: state or verifier missing. Click Sign in with Microsoft again.");
      return;
    }
    if (parsed.state && parsed.state !== stateRef) {
      setError("State in the redirect URL doesn't match this session. Restart sign-in.");
      return;
    }
    await runExchange({ code: parsed.code, state: stateRef });
  }

  async function runExchange({ code, state }) {
    setStep("exchanging");
    try {
      const res = await fetch("/api/oauth/kiro/external-idp/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuerUrl,
          clientId,
          scopes,
          code,
          state,
          codeVerifier: verifierRef,
          region,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Exchange failed (${res.status})`);
      }
      setStep("success");
      onSuccess?.(data.connection);
    } catch (err) {
      setError(err.message || "Token exchange failed");
      setStep("input");
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="External IdP — Microsoft Entra ID">
      <div className="space-y-4">
        {step === "input" && (
          <>
            <p className="text-sm text-gray-400">
              Sign in to Kiro using a Microsoft Entra ID (Azure AD) account that your
              organization has registered. Paste the values your IT admin provided.
            </p>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Issuer URL</label>
              <Input
                value={issuerUrl}
                onChange={(e) => setIssuerUrl(e.target.value)}
                placeholder="https://login.microsoftonline.com/{tenant}/v2.0"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Client ID</label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Azure App Registration client id"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Scopes</label>
              <Input
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">CodeWhisperer region</label>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>

            {portInUse && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Redirect URL (paste after signing in)
                </label>
                <Input
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="http://localhost:3128/oauth/callback?code=…&state=…"
                />
                <Button onClick={handleManualSubmit} className="mt-2" disabled={!manualUrl}>
                  Submit redirect URL
                </Button>
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                onClick={handleSignIn}
                disabled={!issuerUrl || !clientId}
              >
                Sign in with Microsoft
              </Button>
            </div>
          </>
        )}

        {(step === "authorizing" || step === "waiting") && (
          <div className="py-8 text-center">
            <div className="animate-spin h-6 w-6 mx-auto border-2 border-blue-400 border-t-transparent rounded-full" />
            <p className="mt-3 text-sm text-gray-300">
              {step === "authorizing"
                ? "Preparing sign-in…"
                : "Waiting for Microsoft to redirect back to 9router…"}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Complete the sign-in in the browser window that just opened.
            </p>
          </div>
        )}

        {step === "exchanging" && (
          <div className="py-8 text-center">
            <div className="animate-spin h-6 w-6 mx-auto border-2 border-blue-400 border-t-transparent rounded-full" />
            <p className="mt-3 text-sm text-gray-300">Exchanging code for tokens…</p>
          </div>
        )}

        {step === "success" && (
          <div className="py-6 text-center">
            <p className="text-sm text-green-400">Signed in successfully.</p>
          </div>
        )}

        {error && step !== "input" && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}
      </div>
    </Modal>
  );
}

ExternalIdpAuthForm.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};