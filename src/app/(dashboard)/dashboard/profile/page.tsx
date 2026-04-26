import ProfilePageClient from "./ProfilePageClient";
import { getSettings } from "@/lib/localDb";
import { getMachineId } from "@/shared/utils/machine";
import React from "react";

export default async function ProfilePage() {
  const [settings, machineId] = await Promise.all([
    getSettings(),
    getMachineId(),
  ]);

  const initialData = {
    settings: {
      fallbackStrategy: settings.fallbackStrategy || "fill-first",
      outboundProxyEnabled: settings.outboundProxyEnabled || false,
      outboundProxyUrl: settings.outboundProxyUrl || "",
      outboundNoProxy: settings.outboundNoProxy || "",
      requireLogin: settings.requireLogin !== false,
      hasPassword: !!settings.password,
      enableObservability: settings.enableObservability || settings.observabilityEnabled || false,
      enableRtk: settings.enableRtk !== false,
      stickyRoundRobinLimit: settings.stickyRoundRobinLimit || 3,
      comboStrategy: settings.comboStrategy || "fallback",
    },
    machineId,
  };

  return <ProfilePageClient initialData={initialData} />;
}
