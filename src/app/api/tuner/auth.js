import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export async function canEditCombos() {
  const settings = await getSettings();
  if (settings.requireLogin === false) return true;
  const cookieStore = await cookies();
  return await verifyDashboardAuthToken(cookieStore.get("auth_token")?.value);
}
