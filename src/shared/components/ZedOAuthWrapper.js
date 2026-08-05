"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";
import OAuthModal from "./OAuthModal";
import ZedAuthModal from "./ZedAuthModal";

/**
 * Zed connect: choose browser RSA native-app sign-in or paste/import credentials.
 */
export default function ZedOAuthWrapper({ isOpen, providerInfo, onSuccess, onClose }) {
  const [method, setMethod] = useState(null); // null | "browser" | "import"

  const handleClose = () => {
    setMethod(null);
    onClose();
  };

  const handleSuccess = () => {
    setMethod(null);
    onSuccess?.();
  };

  const handleBack = () => setMethod(null);

  if (method === "browser") {
    return (
      <OAuthModal
        isOpen={isOpen}
        provider="zed"
        providerInfo={providerInfo || { name: "Zed Hosted AI" }}
        onSuccess={handleSuccess}
        onClose={handleBack}
      />
    );
  }

  if (method === "import") {
    return (
      <ZedAuthModal
        isOpen={isOpen}
        onSuccess={handleSuccess}
        onClose={handleBack}
      />
    );
  }

  return (
    <Modal isOpen={isOpen} title="Connect Zed Hosted AI" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          Sign in via browser (RSA native-app flow), or import an existing Zed user id + access token.
        </p>
        <button
          type="button"
          onClick={() => setMethod("browser")}
          className="flex items-start gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
        >
          <span className="material-symbols-outlined text-primary mt-0.5">language</span>
          <span>
            <span className="block text-sm font-medium">Sign in with browser</span>
            <span className="block text-xs text-text-muted mt-0.5">
              Opens zed.dev native-app sign-in and captures the encrypted callback locally.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMethod("import")}
          className="flex items-start gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
        >
          <span className="material-symbols-outlined text-primary mt-0.5">key</span>
          <span>
            <span className="block text-sm font-medium">Import credentials</span>
            <span className="block text-xs text-text-muted mt-0.5">
              Paste user_id + access_token from Zed (or auto-detect from the local keyring).
            </span>
          </span>
        </button>
        <Button onClick={handleClose} variant="ghost" fullWidth>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

ZedOAuthWrapper.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.shape({
    name: PropTypes.string,
  }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
