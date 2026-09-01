"use client";

// C61_O2_UI_API_DISPATCH
//
// Thin UI dispatcher only.
// Core OAuth handlers/executors/registries remain authoritative.

import { useEffect, useState } from "react";
import OAuthModal from "./OAuthModal";
import Modal from "./Modal";
import Input from "./Input";
import Button from "./Button";

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function GheCopilotModal(props) {
  const { isOpen, onClose } = props;
  const [gheUrl, setGheUrl] = useState("");
  const [configuredUrl, setConfiguredUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setGheUrl("");
      setConfiguredUrl("");
      setError("");
    }
  }, [isOpen]);

  const closeAll = () => {
    setConfiguredUrl("");
    setError("");
    onClose?.();
  };

  if (configuredUrl) {
    return (
      <OAuthModal
        {...props}
        provider="ghe-copilot"
        providerName={props.providerName || "GitHub Enterprise Copilot"}
        oauthMeta={{
          ...(props.oauthMeta || {}),
          gheUrl: configuredUrl,
        }}
        onClose={closeAll}
      />
    );
  }

  const continueAuth = () => {
    const normalized = normalizeHttpUrl(gheUrl);
    if (!normalized) {
      setError("Enter a valid GitHub Enterprise URL, for example https://github.example.com");
      return;
    }
    setError("");
    setConfiguredUrl(normalized);
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Connect GitHub Enterprise Copilot"
      onClose={closeAll}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-text-muted mb-3">
            Enter the root URL of your GitHub Enterprise instance.
          </p>
          <Input
            value={gheUrl}
            onChange={(event) => setGheUrl(event.target.value)}
            placeholder="https://github.example.com"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={continueAuth} fullWidth disabled={!gheUrl.trim()}>
            Continue
          </Button>
          <Button onClick={closeAll} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function GitLabDuoModal(props) {
  const { isOpen, onClose } = props;
  const [baseUrl, setBaseUrl] = useState("https://gitlab.com");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [configured, setConfigured] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setBaseUrl("https://gitlab.com");
      setClientId("");
      setClientSecret("");
      setConfigured(null);
      setError("");
    }
  }, [isOpen]);

  const closeAll = () => {
    setConfigured(null);
    setError("");
    onClose?.();
  };

  if (configured) {
    return (
      <OAuthModal
        {...props}
        provider="gitlab-duo"
        providerName={props.providerName || "GitLab Duo"}
        oauthMeta={{
          ...(props.oauthMeta || {}),
          baseUrl: configured.baseUrl,
          clientId: configured.clientId,
          clientSecret: configured.clientSecret,
        }}
        onClose={closeAll}
      />
    );
  }

  const continueAuth = () => {
    const normalized = normalizeHttpUrl(baseUrl);
    if (!normalized) {
      setError("Enter a valid GitLab Base URL.");
      return;
    }

    if (!clientId.trim()) {
      setError("Client ID is required.");
      return;
    }

    setError("");
    setConfigured({
      baseUrl: normalized,
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Connect GitLab Duo"
      onClose={closeAll}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-text-muted mb-2">GitLab Base URL</p>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://gitlab.com"
          />
        </div>

        <div>
          <p className="text-sm text-text-muted mb-2">Client ID</p>
          <Input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="OAuth Application ID"
          />
        </div>

        <div>
          <p className="text-sm text-text-muted mb-2">
            Client Secret <span className="text-text-muted">(optional when not required)</span>
          </p>
          <Input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder="OAuth Application Secret"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={continueAuth} fullWidth disabled={!baseUrl.trim() || !clientId.trim()}>
            Continue
          </Button>
          <Button onClick={closeAll} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DevinDesktopModal(props) {
  const { isOpen, onClose, onSuccess } = props;
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setToken("");
      setSubmitting(false);
      setError("");
    }
  }, [isOpen]);

  const closeAll = () => {
    if (submitting) return;
    setToken("");
    setError("");
    onClose?.();
  };

  const submit = async () => {
    const value = token.trim();
    if (!value) return;

    try {
      setSubmitting(true);
      setError("");

      const response = await fetch("/api/oauth/devin-desktop/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || data.message || "Failed to import Devin Desktop token");
      }

      onSuccess?.(data);
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Connect Devin Desktop"
      onClose={closeAll}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Import the Devin Desktop authentication token. The token is sent to the
          existing OAuth exchange endpoint and stored through the normal provider
          credential flow.
        </p>

        <textarea
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste Devin Desktop token..."
          rows={6}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary"
        />

        {error && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} fullWidth disabled={!token.trim() || submitting}>
            {submitting ? "Connecting..." : "Connect"}
          </Button>
          <Button onClick={closeAll} variant="ghost" fullWidth disabled={submitting}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function ProviderOAuthModal(props) {
  switch (props.provider) {
    case "ghe-copilot":
      return <GheCopilotModal {...props} />;

    case "gitlab-duo":
      return <GitLabDuoModal {...props} />;

    case "devin-desktop":
      return <DevinDesktopModal {...props} />;

    default:
      return <OAuthModal {...props} />;
  }
}
