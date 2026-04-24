import React from "react";
import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./endpoint/EndpointPageClient";
import { getSettings, getApiKeys } from "@/lib/localDb";
import { getTunnelStatus, getTailscaleStatus } from "@/lib/tunnel/tunnelManager";

export default async function DashboardPage() {
  const [machineId, settings, tunnelStatus, tailscaleStatus, keysData] = await Promise.all([
    getMachineId(),
    getSettings(),
    getTunnelStatus(),
    getTailscaleStatus(),
    getApiKeys()
  ]);

  const initialData = {
    machineId,
    settings: {
      requireApiKey: settings.requireApiKey || false,
      requireLogin: settings.requireLogin !== false,
      tunnelDashboardAccess: settings.tunnelDashboardAccess || false,
    },
    tunnel: {
      tunnelUrl: tunnelStatus.tunnelUrl || "",
      publicUrl: tunnelStatus.publicUrl || "",
      enabled: tunnelStatus.enabled || false,
    },
    tailscale: {
      tunnelUrl: tailscaleStatus.tunnelUrl || "",
      enabled: tailscaleStatus.enabled || false,
    },
    keys: keysData || []
  };

  return <EndpointPageClient initialData={initialData} />;
}
