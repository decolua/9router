import { NextResponse } from "next/server";
import { proxy as dashboardProxy } from "./dashboardGuard";

// Backend-only mode: serve the gateway, not the web app.
//
// This box runs 9router as an API. The dashboard is a browser UI for a human,
// and since 2026-08-23 the gateway is reachable only over Tailscale, so the UI
// has no audience that could not reach the API directly — a login form, a
// session cookie and a bcrypt compare in front of the process that holds every
// provider credential, bought for a feature nobody here uses.
//
// A gate, not a deletion. This fork tracks upstream and prefers official fixes
// to its own, so removing `src/app/dashboard` would seed a conflict into every
// upstream commit that touches the UI, forever. Twelve lines here conflict with
// nothing.
//
// This lives in proxy.js rather than a middleware.js of its own because Next 16
// refuses to build with both present ("Please use ./src/proxy.js only") — which
// is exactly how the first attempt at this failed.
//
// WHAT STAYS UP, and why each has to:
//   /v1, /v1beta, /codex, /responses   the gateway's client entry points. This
//        runs BEFORE next.config.mjs rewrites, so it sees these raw paths and
//        not the /api/v1 they resolve to; naming only /v1 would 404 every
//        Codex client while /v1 kept working.
//   /api  the 9r-tuner schedule logs in and rewrites combos through it every
//        five minutes, and the MCP tools drive /api/tuner.
//   /callback  provider OAuth redirects land here. Blocking it would surface
//        days later as a dead provider rather than as a 404.
//
// NINEROUTER_DASHBOARD_ENABLED=true restores the UI when a credential needs
// adding. It is a flag, not a demolition.
const DASHBOARD_ENABLED = process.env.NINEROUTER_DASHBOARD_ENABLED === "true";

// Exclusion list, so a page added upstream is disabled by default — the safe
// direction. Static assets are excluded because 404ing them would break the
// rendering of the pages that ARE allowed, and they carry no credentials.
const SERVED = /^\/(api|v1|v1beta|codex|responses|callback|_next|favicon\.ico|manifest\.webmanifest)(\/|$)/;

export default async function proxy(request) {
  if (!DASHBOARD_ENABLED) {
    const { pathname } = new URL(request.url);
    if (!SERVED.test(pathname)) {
      return new NextResponse(
        JSON.stringify({
          error: {
            message:
              "This 9router runs backend-only; the dashboard is disabled. The gateway is at /v1 " +
              "and the control API at /api. Set NINEROUTER_DASHBOARD_ENABLED=true and redeploy to restore the UI.",
            type: "dashboard_disabled",
          },
        }),
        { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }
  }
  return dashboardProxy(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
