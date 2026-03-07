"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getPkceFromSession } from "@/shared/utils/pkceClient";

export default function LoginCallbackPage() {
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("exchanging"); // exchanging | session | done

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const code = searchParams.get("code");
      const stateFromUrl = searchParams.get("state");
      const errorFromUrl = searchParams.get("error");
      const errorDesc = searchParams.get("error_description");

      if (errorFromUrl) {
        setError(errorDesc || errorFromUrl);
        setStatus("done");
        return;
      }
      if (!code || !stateFromUrl) {
        setError("Missing code or state");
        setStatus("done");
        return;
      }

      const { verifier, state } = getPkceFromSession();
      if (!verifier || state !== stateFromUrl) {
        setError("Invalid state or expired. Please try signing in again.");
        setStatus("done");
        return;
      }

      try {
        const configRes = await fetch("/api/auth/microsoft/config");
        if (!configRes.ok) {
          setError("Microsoft auth not configured");
          setStatus("done");
          return;
        }
        const config = await configRes.json();
        const tokenParams = new URLSearchParams({
          client_id: config.clientId,
          code: code,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code",
          code_verifier: verifier,
        });
        const tokenRes = await fetch(config.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenParams.toString(),
        });
        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          setError(errText || "Token exchange failed");
          setStatus("done");
          return;
        }
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) {
          setError("No access token in response");
          setStatus("done");
          return;
        }
        if (cancelled) return;
        setStatus("session");
        const sessionRes = await fetch("/api/auth/microsoft/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: accessToken }),
          credentials: "include",
        });
        if (!sessionRes.ok) {
          const data = await sessionRes.json().catch(() => ({}));
          setError(data.error || "Session creation failed");
          setStatus("done");
          return;
        }
        if (cancelled) return;
        window.location.replace("/dashboard");
      } catch (err) {
        setError(err.message || "Something went wrong");
        setStatus("done");
      }
    };
    run();
    return () => { cancelled = true; };
  }, [searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center max-w-md">
          <p className="text-red-500 mb-4">{error}</p>
          <a href="/login" className="text-primary underline">Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-text-muted mt-4">
          {status === "exchanging" ? "Signing you in…" : "Creating session…"}
        </p>
      </div>
    </div>
  );
}
