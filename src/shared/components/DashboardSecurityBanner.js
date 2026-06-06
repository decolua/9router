"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useDashboardSecurity } from "@/shared/hooks/useDashboardSecurity";
import { SECURITY_COPY } from "@/shared/constants/securityCopy";
import { isSecurityWizardSnoozed } from "@/shared/utils/securityWizardSnooze";
import InlineAlert from "./InlineAlert";

const DETAIL_PAGES = new Set(["/dashboard/profile", "/dashboard/endpoint"]);

/**
 * Global security strip shown on dashboard pages when settings are unsafe.
 */
export default function DashboardSecurityBanner() {
  const pathname = usePathname();
  const {
    loading,
    requireLogin,
    hasPassword,
    requireApiKey,
    remoteExposureActive,
  } = useDashboardSecurity();
  const [wizardActive, setWizardActive] = useState(false);

  useEffect(() => {
    setWizardActive(!isSecurityWizardSnoozed());
  }, []);

  if (loading || DETAIL_PAGES.has(pathname)) return null;

  const issues = [];

  if (!requireLogin) {
    issues.push({
      key: "login-off",
      message: SECURITY_COPY.requireLoginOff,
      action: { label: "Profile", href: "/dashboard/profile" },
    });
  }

  if (!hasPassword) {
    issues.push({
      key: "default-password",
      message: SECURITY_COPY.defaultPassword,
      action: { label: "Set password", href: "/dashboard/profile" },
    });
  }

  if (remoteExposureActive && !requireApiKey) {
    issues.push({
      key: "api-key-off",
      message: SECURITY_COPY.requireApiKeyOff,
      action: { label: "Endpoint", href: "/dashboard/endpoint" },
    });
  }

  if (issues.length === 0) return null;

  // FirstRunSecurityWizard shows the same issues in a richer checklist — avoid duplicate alerts.
  if (wizardActive) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {issues.map((issue) => (
        <InlineAlert
          key={issue.key}
          variant="warning"
          message={issue.message}
          action={issue.action}
          compact
        />
      ))}
    </div>
  );
}
