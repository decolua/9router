import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./EndpointPageClient";
import { getSettings } from "@/lib/localDb";
import { getTunnelStatus, getTailscaleStatus } from "@/lib/tunnel/tunnelManager";
import { getApiKeys } from "@/lib/localDb";
import React from "react";

export default async function EndpointPage() {
  let machineId = "";
  let settings: any = { requireApiKey: false, requireLogin: true, tunnelDashboardAccess: false };
  let tunnelStatus: any = { tunnelUrl: "", publicUrl: "", enabled: false };
  let tailscaleStatus: any = { tunnelUrl: "", enabled: false };
  let keysData: any[] = [];

  try {
    const results = await Promise.allSettled([
      getMachineId(),
      getSettings(),
      getTunnelStatus(),
      getTailscaleStatus(),
      getApiKeys()
    ]);

    if (results[0].status === "fulfilled") machineId = results[0].value;
    if (results[1].status === "fulfilled") settings = results[1].value;
    if (results[2].status === "fulfilled") tunnelStatus = results[2].value;
    if (results[3].status === "fulfilled") tailscaleStatus = results[3].value;
    if (results[4].status === "fulfilled") keysData = results[4].value;
  } catch (error) {
    console.error("Error prefetching endpoint data:", error);
  }

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
