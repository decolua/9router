# NexusRemote · Mirror-Glass Web Platform

Production website: https://nexusremote-operations.vercel.app

## Pages
- / — polished, responsive, mirrored-glass landing page
- /apply — consent-based candidate intake, private Vercel Blob storage, human review
- /login — secure owner or worker login (no hardcoded passwords)
- /portal — cookie-authenticated owner and worker dashboards with live private backend records
- /privacy — transparent data notice and access/deletion request intake

## Architecture
- Vercel Serverless Node 24 + private Cape Town Vercel Blob storage
- Owner login verifies the encrypted Vercel ADMIN_API_TOKEN. This is a high-entropy secret, not a default username/password.
- Worker login verifies a separately approved worker ID plus invitation token stored only as a hash. No real campaign or job is asserted.
- Session cookie: HttpOnly, Secure, SameSite=Lax, HMAC-SHA256 with expiry. Server verifies roles and user status; no client local-storage authentication.
- Forms require consent and same-origin POST; applications enter pending_human_review.
- Owner can review and approve portal-only access manually. A private invite token is revealed once, must be shared securely.
- Earnings are sourced solely from signed Stripe paid webhook events. No simulated sales or bank deposits are shown.
- Data access/deletion requests are privately logged for manual identity verification.
- Previous owner MCP, legacy authorization endpoints and Stripe signature protection are preserved.

## Safety
- Never ask job applicants for onboarding, training or equipment fees.
- No verified campaign provider, WhatsApp template or business email is yet connected; show disabled/awaiting status.
- Do not advertise a guaranteed vacancy or pay.
- This is not Stripe live-mode activation; Stripe connected account is currently sandbox only.
- Human review is required for recruitment and data rights.
- Public-facing recruitment needs verified legal-operator details, responsible-party contact, rate limiting/CAPTCHA and a formal retention policy before scaling.

## Run checks
npm install
npm test

## Credentials
ADMIN_API_TOKEN is set as an encrypted Vercel env variable; never commit it or distribute it. If lost, use Vercel Settings > Environment Variables to reset/rotate it and redeploy. Workers need approved invitation codes.
