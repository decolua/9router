import CombosPageClient from "./CombosPageClient";
import { getCombos, getSettings, getProviderConnections } from "@/lib/localDb";
import { getMachineId } from "@/shared/utils/machine";
import React from "react";

export default async function CombosPage() {
 const [combos, settings, connections, machineId] = await Promise.all([
 getCombos(),
 getSettings(),
 getProviderConnections(),
 getMachineId(),
 ]);

 const initialData = {
 combos: combos || [],
 settings: {
   comboStrategies: settings.comboStrategies || {},
 },
 connections: connections || [],
 machineId,
 };

 return <CombosPageClient initialData={initialData} />;
}
