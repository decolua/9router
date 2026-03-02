export { proxy } from "./dashboardGuard";

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
