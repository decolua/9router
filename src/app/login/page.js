"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function LoginPage() {
  const t = useTranslations();
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [activeTab, setActiveTab] = useState("password");
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/settings`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.requireLogin === false) {
            router.push("/dashboard");
            router.refresh();
            return;
          }
          setHasPassword(!!data.hasPassword);
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const isApiKeyLogin = activeTab === "apiKey";
      const endpoint = isApiKeyLogin ? "/api/auth/api-key-login" : "/api/auth/login";
      const payload = isApiKeyLogin ? { apiKey } : { password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || (isApiKeyLogin ? t("login.invalidApiKey") : t("login.invalidPassword")));
      }
    } catch (err) {
      setError(t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">{t("login.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">9Router</h1>
          <p className="text-text-muted">{t("login.subtitle")}</p>
        </div>

        <Card>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex gap-2 rounded-lg bg-bg-subtle p-1 border border-border">
              <button
                type="button"
                onClick={() => setActiveTab("password")}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "password"
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-muted hover:text-text hover:bg-bg-hover"
                }`}
              >
                {t("login.tabPassword")}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("apiKey")}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === "apiKey"
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-muted hover:text-text hover:bg-bg-hover"
                }`}
              >
                {t("login.tabApiKey")}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {activeTab === "password" ? (
                <>
                  <label className="text-sm font-medium">{t("login.passwordLabel")}</label>
                  <Input
                    type="password"
                    placeholder={t("login.passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                </>
              ) : (
                <>
                  <label className="text-sm font-medium">{t("login.apiKeyLabel")}</label>
                  <Input
                    type="text"
                    placeholder={t("login.apiKeyPlaceholder")}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    required
                    autoFocus
                  />
                </>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={loading}
            >
              {activeTab === "apiKey" ? t("login.loginWithApiKey") : t("login.login")}
            </Button>

            {activeTab === "password" ? (
              <p className="text-xs text-center text-text-muted mt-2">
                {t("login.defaultPasswordPrefix")} <code className="bg-sidebar px-1 rounded">123456</code>
              </p>
            ) : (
              <p className="text-xs text-center text-text-muted mt-2">
                {t("login.quotaPrefix")} <a className="text-primary hover:underline" href="/key-status">/key-status</a>.
              </p>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
