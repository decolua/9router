import { NextResponse } from "next/server";

// Backend-only mode: serve the gateway, not the web app.
//
// This box runs 9router as an API. The dashboard is a browser UI for a human,
// and since 2026-08-23 the gateway is reachable only over Tailscale, so the UI
// has no audience it could not reach another way. Shipping it anyway means a
// login form, a session cookie, and a bcrypt compare sitting in front of the
// thing that holds every provider credential — attack surface bought for a
// feature nobody here uses.
//
// WHY A GATE AND NOT A DELETION. This fork tracks upstream and takes official
// fixes in preference to its own. Deleting `src/app/dashboard` would put a
// conflict in the path of every upstream commit that touches the UI, forever,
// which is exactly the maintenance the merge policy exists to avoid. One file
// that upstream does not have cannot conflict with anything.
//
// WHAT STAYS UP, and why each one has to:
//   /v1/*      the gateway itself (next.config.mjs rewrites it to /api/v1/*)
//   /v1beta/*  the Gemini-shaped entry point, same rewrite table
//   /codex/*   and /responses — the Codex/Responses entry points. Middleware
//              runs BEFORE rewrites, so it sees these raw client paths, not the
//              /api/v1 they resolve to. Leaving them out of the matcher would
//              404 every Codex client while /v1 kept working.
//   /api/*     the tuner logs in at /api/auth/login and writes /api/combos/:id
//              every five minutes; the MCP tools drive /api/tuner/*
//   /callback  provider OAuth redirects land here. Blocking it would silently
//              break credential renewal, and the failure would surface days
//              later as a dead provider rather than as a 404.
//
// TO GET THE UI BACK — adding a provider connection still needs it — set
// NINEROUTER_DASHBOARD_ENABLED=true on the app and redeploy. It is a flag, not
// a demolition, so that is a one-line change and not a revert.
const DASHBOARD_ENABLED = process.env.NINEROUTER_DASHBOARD_ENABLED === "true";

export function middleware(request) {
  if (DASHBOARD_ENABLED) return NextResponse.next();

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

// Negative matcher: everything EXCEPT the paths above. Written as an exclusion
// rather than a list of UI routes so a page added upstream is disabled by
// default — the safe direction. `_next` and static assets are excluded because
// a 404 on those turns the allowed pages into broken renders, and they carry
// no credentials.
export const config = {
  matcher: [
    "/((?!api|v1|v1beta|codex|responses|callback|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)",
  ],
};
