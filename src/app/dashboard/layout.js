import { dashboardPageRole } from "@/lib/auth/dashboardPageRole";
import ViewerBanner from "@/shared/components/ViewerBanner";

// Standalone settings pages live outside the dashboard route group's layout.
export default async function SettingsLayout({ children }) {
  return <><ViewerBanner role={await dashboardPageRole()} />{children}</>;
}
