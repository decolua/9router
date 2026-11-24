# NexusRemote — Android app

This is a compiled native Android application that embeds only the HTTPS NexusRemote web portal at https://nexusremote-operations.vercel.app. It is NOT a fully offline call-center or independent dialer.

Features:
- Launch Home, Apply, Worker and Owner from native tabs.
- Check portal reachability and display reported integration flags without treating them as proof of live activation.
- Owner and worker access remain protected by the deployed backend.
- No credentials embedded, no SMS/contact/microphone/camera/location permissions.
- External domains open in the system browser; HTTPS only in WebView.
- Android 8+.

Building: Use Java 17, the Gradle 8.11.1 wrapper, Android SDK 36 and run `./gradlew :app:assembleDebug --no-daemon` inside `nexusremote-android/`. Installable debug APK at `app/build/outputs/apk/debug/app-debug.apk`. Debug-signed for sideload testing; not an official app-store release.

Important:
- Recruitment and worker access cannot be fully active before a real employer, consent, approved workers, professional email domain and legitimate campaigns.
- No live Stripe payments, worker payouts or WhatsApp alerts are claimed; these require explicit provider activation and testing.
- The public website is hosted on Vercel and storage is private.

## Release-readiness update

The updated build uses Java 17, the checksum-pinned Gradle 8.11.1 wrapper,
Android Gradle Plugin 8.10.1 and Android SDK 36 (Build Tools 35.0.0).
From this directory run:

```sh
./gradlew :app:assembleDebug :app:lintDebug :app:testDebugUnitTest --no-daemon
sh tests/run-policy-tests.sh
node --test tests/*.test.cjs
```

The debug APK is still only for sideload testing. A successful workflow verifies
compilation, lint, policy regressions and APK signing; it does not establish
on-device behavior, backend authorization, store approval or live payments.

The app displays missing integration fields as **unknown**. A true backend flag
is **reported enabled (unverified)**, not proof of a completed live transaction.
Payout status remains unknown. No provider is activated by this update.

### Release signing

`bundleRelease` requires all four environment variables:
`NEXUS_UPLOAD_STORE_FILE` (absolute keystore path),
`NEXUS_UPLOAD_STORE_PASSWORD`, `NEXUS_UPLOAD_KEY_ALIAS`, and
`NEXUS_UPLOAD_KEY_PASSWORD`. Never commit a keystore or password.
There is no debug-key fallback. Configure the `android-release` GitHub environment
with `NEXUS_UPLOAD_KEYSTORE_BASE64` and the three password/alias secrets, and its
required reviewers/protection rules. The manual workflow's `build_release` option
builds a signed candidate on master; it does not publish it.
Use Play App Signing and retain a secure backup of the upload identity.

### Remaining release gates

- Identify the source and deployment owning the hosted NexusRemote portal.
  The root 9Router `/api/health` returning `{ok:true}` is not evidence that it
  owns the portal. Verify a documented health contract against the real deployment.
- Verify server-side Owner/Worker authorization, per-worker isolation, secure
  sessions, expiry, logout and CSRF protection. Native tabs do not grant access.
- Publish privacy/support information and an accurate Data safety declaration
  covering the hosted WebView. Provide in-app and web account deletion if account
  creation is offered, with documented retention rules.
- Add approved launcher/store artwork, screenshots, content rating and reviewer
  access. Confirm developer verification and account-specific testing requirements.
- Test Android 8, 15 and 16 on devices/emulators: four tabs, cold start, early tab
  presses, process restoration, keyboard, cutouts, gestures, large fonts, TalkBack,
  offline/slow network, HTTP errors, TLS failure and external links.
- Verify release identity, non-debuggable output, upgrade installation, bundle
  validation and Play internal testing before production.
- Keep recruitment, Stripe payments, worker payouts, WhatsApp alerts and dialer
  features unavailable unless their separate backend/provider prerequisites are
  fulfilled and end-to-end tests recorded. Do not advertise earnings or activation.

Original statements about private storage and protected access describe the intended
hosted service; this Android source review alone does not independently verify them.
