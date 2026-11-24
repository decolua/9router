import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { dashboardRole } from "@/dashboardGuard";

export const dashboardPageRole = cache(async () =>
  dashboardRole({ cookies: await cookies(), headers: await headers() })
);
