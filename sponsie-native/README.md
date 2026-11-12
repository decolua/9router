# Sponsie Autopilot Native Android MVP

This standalone offline Android application is a small, original native companion to the existing Termux-hosted Sponsie Python suite. It is **not** that Python runtime bundled inside an APK. It does not execute local LLM inference and does not connect to n8n, Custom GPT Actions, external job boards or Cerebrium.

Features implemented: mobile dashboard, native persistent SQLite project/approval history, draft generation for HTML landing pages, proposals, research ledgers and content, manual Android share/export of draft text, owner confirmation before marking a draft ready. There are no client data collectors, paid API keys, background account connections, automatic messages, contracts or payment flows. All generated drafts carry explicit warnings. No Internet permission.

Build (Java 17 and Android SDK 35): `gradle :app:assembleDebug --no-daemon` in this directory. For GitHub CI copy this directory to `sponsie-native/` and add supplied workflow. Install `app/build/outputs/apk/debug/app-debug.apk` from GitHub Actions artifacts after verifying SHA-256.

The debug APK is signed with Android's development key and is **not** a Play Store release. Install only for personal device testing. No device test has been performed unless explicitly verified on device.


## Version 0.2: colony owner entrance

The welcome screen now contains an original 3D-rendered business hive image, functional first-run local owner account and password sign-in, device-only PBKDF2-HMAC-SHA256 password hashing with per-install random salt, 30-second rate pause after five failures, lock-on-background, and an explicit lock button. Accounts are **device-local only** and do not synchronize or perform external authentication; clearing app data removes the local account and tasks. No remote payment network, internet permission, or external service is enabled.


## 0.3: optional internet discovery

Android manifest permits INTERNET and ACCESS_NETWORK_STATE and keeps cleartext HTTP prohibited. Owner sees a validated connectivity status. Signed-in users may manually pull a capped, cached read-only HTTPS feed from **Remotive** (`https://remotive.com/api/remote-jobs?limit=100`). Updates occur no more than once every six hours to respect its four-per-day advisory. The model filters *possible* South Africa-eligible geography tags, but does not verify employment eligibility or availability. Full original application details must be checked on Remotive; each link opens in an external browser only after confirmation. Attribution and links comply with the [Remotive API requirements](https://remotive.com/remote-jobs/api). If offline, saved results remain accessible; no data (emails, passwords, briefs) is uploaded to Remotive. No Auth0, cloud sync, n8n, payment services or automatic job application has been activated.
