import ProxyPoolsPageClient from "./ProxyPoolsPageClient";
import { getProxyPools, getSettings } from "@/lib/localDb";
import { getMachineId } from "@/shared/utils/machine";
import React from "react";

export default async function ProxyPoolsPage() {
 const [proxyPools, settings, machineId] = await Promise.all([
 getProxyPools(),
 getSettings(),
 getMachineId(),
 ]);

 const initialData = {
 proxyPools: proxyPools || [],
 settings: {
   cloudEnabled: settings.cloudEnabled || false,
 },
 machineId,
 };

 return <ProxyPoolsPageClient initialData={initialData} />;
}
