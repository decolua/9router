# NexusRemote — 3D Mirror Spatial Edition

**Production:** https://nexusremote-operations.vercel.app

A live-hosted, responsive remote recruiting and workforce operations platform built on Vercel serverless Node.js with private applicant storage. No frontend earnings simulation or unverified onboarding promises.

## Design & interaction
- Premium mirrored-glass UI with CSS-based 3D spiral representing all five divisions.
- Rotation follows vertical page scroll. Touch-swipe / drag, wheel, arrow keys, Home/End and accessible buttons also work.
- Motion respects reduced-motion accessibility settings. CSS 3D avoids GPU-heavy WebGL and is tuned for mobile devices.
- Live public remote jobs via Himalayas with source attribution, bounded searches, strict URL validation and original posting links.
- Local-only equipment readiness guide. This does not accept or reject applicants.
- Saved public job listings (browser-local), searchable roles, CSV export with formula-injection protection.
- Optional PWA install prompt and isolated offline shell; private records, login, API and financial details are network-only.
- Owner-only candidate filter, authorized CSV export and activity timeline populated from actual backend application and Stripe-verified events.

## Main routes
- \`/\` — mirror-glass landing, touch 3D division explorer, opportunities and readiness
- \`/apply\` — consent-based candidate form
- \`/login\` — separate worker invitation or owner-key login
- \`/portal\` — role-protected dashboard with true live records
- \`/privacy\` — privacy notice and data-rights request intake
- \`/api/opportunities?q=customer%20support&country=ZA\` — public Himalayas job feed proxy
- \`/api/health\` — read-only availability state
- \`/api/session\` — signed, HttpOnly session login, session status and logout
- \`/api/portal\` — authenticated role-scoped records and manual approval
- \`/api/stripe\` — signed Stripe paid-event webhook (not live until connected)
- \`/api/mcp\` — authenticated owner MCP tools, read-only
- \`/api/privacy\` — secure privacy request intake

## Integrity and limitations
- Stripe is currently not activated for live payments; WhatsApp alerts, verified business email and a live call-center dialer are not connected. The UI states these restrictions clearly.
- Human review is mandatory for recruitment. No upfront worker fees or guaranteed jobs or earnings.
- Third-party job advertisements are not NexusRemote campaigns and eligibility must be confirmed at the employer source.
- Before public recruitment at scale, add verified operator contact/legal details, formal retention policy, anti-abuse controls and verified professional business email.
- Candidate and financial records remain in the existing private Blob store; no migration or loss of existing records from this UI deployment.
- The deployed website URL is a Vercel subdomain. Registering an independent paid domain requires domain ownership and DNS setup.

## Verification
\`\`\`sh
npm install
npm test
\`\`\`
Build checks include Node syntax on the production JavaScript, original backend security tests, and assertions for the spiral, source URL validation, owner-only tools and service-worker cache boundary.
Further verification: manually test visual and touch smoothness on target Android handsets; browser-based layout QA is not equivalent to real-device profiling.
