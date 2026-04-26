"use client";

import React, { useRef, useState } from "react";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { useTheme } from "@/shared/hooks/useTheme";
import { translate } from "@/i18n/runtime";
import { toast } from "sonner";
import { SettingsPageShell } from "../_settings/components";
import {
  AppInfoSection,
  LocalModeSection,
  NetworkSection,
  ObservabilitySection,
  RoutingSection,
  SecuritySection,
  type Settings,
} from "./sections";
interface ProfilePageClientProps {
  initialData: {
    settings: Settings;
    machineId: string;
  };
}

export default function ProfilePageClient({ initialData }: ProfilePageClientProps) {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings>(
    initialData?.settings || {
      fallbackStrategy: "fill-first",
      outboundProxyEnabled: false,
      outboundProxyUrl: "",
      outboundNoProxy: "",
      requireLogin: true,
      enableObservability: false,
      enableRtk: true,
      stickyRoundRobinLimit: 3,
      comboStrategy: "fallback",
    },
  );
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passLoading, setPassLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [proxyForm, setProxyForm] = useState({
    outboundProxyEnabled: initialData?.settings?.outboundProxyEnabled === true,
    outboundProxyUrl: initialData?.settings?.outboundProxyUrl || "",
    outboundNoProxy: initialData?.settings?.outboundNoProxy || "",
  });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  const updateOutboundProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProxyUrl: proxyForm.outboundProxyUrl,
          outboundNoProxy: proxyForm.outboundNoProxy,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        toast.success(translate("Proxy settings applied"));
      } else {
        toast.error(data.error || translate("Failed to update proxy settings"));
      }
    } catch {
      toast.error(translate("An error occurred"));
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;

    const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
    if (!proxyUrl) {
      toast.error(translate("Please enter a Proxy URL to test"));
      return;
    }

    setProxyTestLoading(true);

    try {
      const res = await fetch("/api/settings/proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl }),
      });

      const data = await res.json();
      if (res.ok && data?.ok) {
        toast.success(`${translate("Proxy test OK")} (${data.status}) ${translate("in")} ${data.elapsedMs}ms`);
      } else {
        toast.error(data?.error || translate("Proxy test failed"));
      }
    } catch {
      toast.error(translate("An error occurred"));
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled: boolean) => {
    setProxyLoading(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundProxyEnabled }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyForm((prev) => ({ ...prev, outboundProxyEnabled: data?.outboundProxyEnabled === true }));
        toast.success(outboundProxyEnabled ? translate("Proxy enabled") : translate("Proxy disabled"));
      } else {
        toast.error(data.error || translate("Failed to update proxy settings"));
      }
    } catch {
      toast.error(translate("An error occurred"));
    } finally {
      setProxyLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      toast.error(translate("Passwords do not match"));
      return;
    }

    setPassLoading(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(translate("Password updated successfully"));
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        toast.error(data.error || translate("Failed to update password"));
      }
    } catch {
      toast.error(translate("An error occurred"));
    } finally {
      setPassLoading(false);
    }
  };

  const updateFallbackStrategy = async (strategy: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallbackStrategy: strategy }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update settings:", err);
    }
  };

  const updateComboStrategy = async (strategy: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategy: strategy }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, comboStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update combo strategy:", err);
    }
  };

  const updateStickyLimit = async (limit: string) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Failed to update sticky limit:", err);
    }
  };

  const updateRequireLogin = async (requireLogin: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
    }
  };

  const updateObservabilityEnabled = async (enabled: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableObservability: enabled }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, enableObservability: enabled }));
      }
    } catch (err) {
      console.error("Failed to update enableObservability:", err);
    }
  };

  const updateRtkEnabled = async (enabled: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableRtk: enabled }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, enableRtk: enabled }));
      }
    } catch (err) {
      console.error("Failed to update enableRtk:", err);
    }
  };

  const reloadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Failed to reload settings:", err);
    }
  };

  const handleExportDatabase = async () => {
    setDbLoading(true);
    try {
      const res = await fetch("/api/settings/database");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to export database");
      }

      const payload = await res.json();
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      anchor.href = url;
      anchor.download = `8router-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toast.success(translate("Database backup downloaded"));
    } catch (err: any) {
      toast.error(err.message || translate("Failed to export database"));
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setDbLoading(true);

    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);

      const res = await fetch("/api/settings/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || translate("Failed to import database"));
      }

      await reloadSettings();
      toast.success(translate("Database imported successfully"));
    } catch (err: any) {
      toast.error(err.message || translate("Invalid backup file"));
    } finally {
      if (importFileRef.current) {
        importFileRef.current.value = "";
      }
      setDbLoading(false);
    }
  };

  const observabilityEnabled = settings.enableObservability === true;
  const rtkEnabled = settings.enableRtk !== false;

  return (
    <SettingsPageShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <SlidersHorizontalIcon className="size-4" weight="bold" />
            {translate("Core Services")}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{translate("System Profile")}</h1>
          <p className="text-sm text-muted-foreground">{translate("Configure runtime, security, routing, and network.")}</p>
        </div>

        <div className="space-y-6">
          <LocalModeSection
            machineId={initialData?.machineId}
            theme={theme}
            setTheme={(value) => setTheme(value as any)}
            dbLoading={dbLoading}
            importFileRef={importFileRef}
            onExport={handleExportDatabase}
            onImport={handleImportDatabase}
          />

          <SecuritySection
            settings={settings}
            passwords={passwords}
            setPasswords={setPasswords}
            passLoading={passLoading}
            onRequireLoginChange={() => updateRequireLogin(!settings.requireLogin)}
            onSubmit={handlePasswordChange}
          />

          <RoutingSection
            settings={settings}
            onFallbackToggle={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")}
            onStickyChange={updateStickyLimit}
            onComboToggle={() => updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")}
          />

          <NetworkSection
            settings={settings}
            proxyForm={proxyForm}
            setProxyForm={setProxyForm}
            proxyLoading={proxyLoading}
            proxyTestLoading={proxyTestLoading}
            onToggleProxy={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))}
            onSubmitProxy={updateOutboundProxy}
            onTestProxy={testOutboundProxy}
          />

          <ObservabilitySection
            enabled={observabilityEnabled}
            rtkEnabled={rtkEnabled}
            onChange={updateObservabilityEnabled}
            onRtkChange={updateRtkEnabled}
          />

          <AppInfoSection />
        </div>
      </div>
    </SettingsPageShell>
  );
}
