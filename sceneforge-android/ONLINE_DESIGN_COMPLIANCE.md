# SceneForge Studio: Online design and compliance tools

## Scope
SceneForge remains **internet-only**. The Android wrapper loads https://sceneforge-studio.hatchable.site. No offline renderer or AI model is installed.

The **Design tools** launcher opens Figma, Canva, the existing SceneForge Canva UI style guide and cinematic VFX overlay, and the official Ansvar Gateway quickstart. External sites open in the device browser, not inside the privileged WebView.

## Ansvar Gateway usage
Ansvar Gateway is accessible from this owner's connected ChatGPT session. On 2026-11-01 the gateway capability check succeeded and a search returned cited NIST SP 800-218 (SSDF) controls PO.5.1 (separation and protection of environments) and PW.1.1 (risk modeling, including authentication and access control). Official NIST source: https://csrc.nist.gov/pubs/sp/800/218/final.

Official Ansvar MCP endpoint: https://gateway.ansvar.eu/mcp; setup https://ansvar.eu/docs/quickstart. Supported clients authenticate with OAuth. No OAuth token or credentials are stored in the SceneForge Android source or APK. The Android app only opens the official quickstart website. A direct app-to-Ansvar API integration is **not** implemented.

## Operating workflow
1. Request a specific release, privacy or cybersecurity assessment using the connected Ansvar Gateway in ChatGPT or another authorized MCP client.
2. Record exact control/article references and whether evidence was returned, missing or unavailable.
3. Compare findings with SceneForge's real deployed source and behavior. A standards lookup alone is not certification.
4. Apply reviewed GitHub changes, build and run automated tests, then verify on a physical Samsung Galaxy A07.

## Existing security limitations
- The v15 source removes the broad addJavascriptInterface export bridge and uses an origin-scoped AndroidX WebMessageListener with isMainFrame checks. This is source-level hardening, not an independently tested security guarantee. Third-party library and WebView runtime behaviors require APK and device verification.
- Hatchable sign-in navigation still permits hatchable.com subdomains for compatibility. Only the exact sceneforge-studio.hatchable.site origin is allowed to invoke the native export endpoint. Audit the authentication redirects before public release.
- File saving is limited to PNG/WebM/MP4 with a 30 MB byte cap, but real-device export and playback are not verified in this PR.
- The launcher does not upload automatically to Figma, Canva or Ansvar and does not sync design files.
- The new share chooser uses the most recent saved MediaStore file and is designed for Android 10+. Android 8-9 should use the existing export workflow.

## Verified vs not verified
Verified: Ansvar Gateway connection in ChatGPT, NIST SSDF reference lookup, and changes committed to the GitHub feature branch.
Not verified: compiled APK, device install, export-sharing interoperability, cloud sync, production security hardening or regulatory conformity.