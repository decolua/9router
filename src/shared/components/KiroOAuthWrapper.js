"use client";

import { useState, useCallback } from "react";
import PropTypes from "prop-types";
import OAuthModal from "./OAuthModal";
import KiroAuthModal from "./KiroAuthModal";
import KiroSocialOAuthModal from "./KiroSocialOAuthModal";

/**
 * Kiro OAuth Wrapper
 * Orchestrates between method selection, device code flow, and social login flow
 */
export default function KiroOAuthWrapper({ isOpen, providerInfo, onSuccess, onClose }) {
  const [authMethod, setAuthMethod] = useState(null); // null | "builder-id" | "idc" | "social" | "import"
  const [socialProvider, setSocialProvider] = useState(null); // "google" | "github"
  const [builderIdConfig, setBuilderIdConfig] = useState(null);
  const [idcConfig, setIdcConfig] = useState(null);

  const handleMethodSelect = useCallback((method, config) => {
    if (method === "builder-id") {
      // Use device code flow (AWS Builder ID) with config
      setAuthMethod("builder-id");
      setBuilderIdConfig(config);
    } else if (method === "idc") {
      // Use device code flow with IDC config
      setAuthMethod("idc");
      setIdcConfig(config);
    } else if (method === "social") {
      // Use social login with manual callback
      setAuthMethod("social");
      setSocialProvider(config.provider);
    } else if (method === "import") {
      // Import handled in KiroAuthModal, just close
      onSuccess?.();
    }
  }, [onSuccess]);

  const handleBack = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    setBuilderIdConfig(null);
    setIdcConfig(null);
  };

  const handleSocialSuccess = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    onSuccess?.();
    onClose?.(); // Close modal after success
  };

  const handleDeviceSuccess = () => {
    setAuthMethod(null);
    setBuilderIdConfig(null);
    setIdcConfig(null);
    onSuccess?.();
    onClose?.(); // Close modal after success
  };

  // Show method selection first
  if (!authMethod) {
    return (
      <KiroAuthModal
        isOpen={isOpen}
        onMethodSelect={handleMethodSelect}
        onClose={onClose}
      />
    );
  }

  // Show device code flow (Builder ID or IDC)
  if (authMethod === "builder-id" || authMethod === "idc") {
    const deviceConfig = authMethod === "builder-id" ? builderIdConfig : idcConfig;
    return (
      <OAuthModal
        isOpen={isOpen}
        provider="kiro"
        providerInfo={providerInfo}
        onSuccess={handleDeviceSuccess}
        onClose={handleBack}
        deviceConfig={deviceConfig}
      />
    );
  }

  // Show social login flow (Google/GitHub with manual callback)
  if (authMethod === "social" && socialProvider) {
    return (
      <KiroSocialOAuthModal
        isOpen={isOpen}
        provider={socialProvider}
        onSuccess={handleSocialSuccess}
        onClose={handleBack}
      />
    );
  }

  return null;
}

KiroOAuthWrapper.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.shape({
    name: PropTypes.string,
  }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
