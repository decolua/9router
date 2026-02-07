import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DashboardLayout } from "@/shared/components";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

export default async function DashboardRootLayout({ children }) {
  let authType = "admin";
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (token) {
      const { payload } = await jwtVerify(token, SECRET);
      authType = payload?.authType || "admin";
    }
  } catch (error) {
    authType = "admin";
  }

  return <DashboardLayout authType={authType}>{children}</DashboardLayout>;
}

