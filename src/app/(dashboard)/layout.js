import { DashboardLayout } from "@/shared/components";

import { dashboardPageRole } from "@/lib/auth/dashboardPageRole";

export default async function DashboardRootLayout({ children }) {
  return <DashboardLayout role={await dashboardPageRole()}>{children}</DashboardLayout>;
}

