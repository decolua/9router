"use server";

// Server action backing the Export Keys modal — deliberately NOT a REST
// endpoint: raw credentials must not gain another fetchable API surface.
// Reached only from the dashboard page bundle; the dashboard session cookie
// is verified server-side before any key leaves the store.
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";

export async function exportProviderKeys(providerId) {
  const token = (await cookies()).get("auth_token")?.value;
  if (!(await verifyDashboardAuthToken(token))) {
    return { error: "Unauthorized" };
  }
  if (typeof providerId !== "string" || !providerId) return { error: "Bad provider" };

  const connections = await getProviderConnections({ provider: providerId });
  return {
    connections: connections.map((c) => ({
      id: c.id,
      name: c.displayName || c.name || c.email || c.id,
      authType: c.authType,
      key: c.apiKey || c.accessToken || "",
    })),
  };
}
