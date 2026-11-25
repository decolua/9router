import { dashboardPageRole } from "@/lib/auth/dashboardPageRole";
import { notFound } from "next/navigation";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getMachineId } from "@/shared/utils/machine";
import ToolDetailClient from "./ToolDetailClient";

export default async function ToolDetailPage({ params }) {
  if (await dashboardPageRole() !== "admin") return null;
  const { toolId } = await params;
  if (!CLI_TOOLS[toolId]) notFound();
  const machineId = await getMachineId();
  return <ToolDetailClient toolId={toolId} machineId={machineId} />;
}
