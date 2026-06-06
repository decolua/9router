"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDashboardSecurity } from "@/shared/hooks/useDashboardSecurity";
import { SECURITY_COPY } from "@/shared/constants/securityCopy";
import { isSecurityWizardSnoozed, snoozeSecurityWizard } from "@/shared/utils/securityWizardSnooze";
import InlineAlert from "./InlineAlert";
import { Button } from "@/shared/components";

/**
 * First-run checklist when dashboard security settings are still unsafe.
 */
export default function FirstRunSecurityWizard() {
  const {
    loading,
    requireLogin,
    hasPassword,
    requireApiKey,
    remoteExposureActive,
  } = useDashboardSecurity();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    setHidden(isSecurityWizardSnoozed());
  }, []);

  if (loading || hidden) return null;

  const steps = [];

  if (!hasPassword) {
    steps.push({
      key: "password",
      title: "Set a custom password",
      detail: SECURITY_COPY.defaultPassword,
      href: "/dashboard/profile",
      action: "Open Profile",
    });
  }

  if (!requireLogin) {
    steps.push({
      key: "login",
      title: "Require dashboard login",
      detail: SECURITY_COPY.requireLoginOff,
      href: "/dashboard/profile",
      action: "Enable login",
    });
  }

  if (remoteExposureActive && !requireApiKey) {
    steps.push({
      key: "api-key",
      title: "Require API keys for remote access",
      detail: SECURITY_COPY.requireApiKeyOff,
      href: "/dashboard/endpoint",
      action: "Review Endpoint",
    });
  }

  if (steps.length === 0) return null;

  const handleSnooze = () => {
    snoozeSecurityWizard();
    setHidden(true);
  };

  return (
    <div className="mb-4 rounded-xl border border-warning/25 bg-warning/10 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-text-main">Secure your dashboard</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Complete these steps before sharing tunnels or exposing the dashboard remotely.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSnooze}
          className="text-xs text-text-muted hover:text-text-main shrink-0"
        >
          Remind me tomorrow
        </button>
      </div>

      <ol className="flex flex-col gap-2 mb-3">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-main">
                {index + 1}. {step.title}
              </p>
              <p className="text-xs text-text-muted mt-0.5">{step.detail}</p>
            </div>
            <Link href={step.href} className="shrink-0">
              <Button variant="secondary" size="sm">
                {step.action}
              </Button>
            </Link>
          </li>
        ))}
      </ol>

      <InlineAlert
        variant="info"
        compact
        message="Tunnel dashboard access stays off by default. Turn it on in Endpoint only after these steps are done."
      />
    </div>
  );
}
