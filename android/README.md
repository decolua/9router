# Agent 01 Android APK

Native Android command center (Java, no third-party runtime libraries). Launches current private Vercel AI dashboard, personal API, MCP health, Frontier control plane, GitHub Actions and Superpowers sources. Also supports live model requests to the owner's own OpenAI-compatible API using a per-user token encrypted with Android Keystore (AES-256-GCM).

## Build
Android SDK Platform 35 + Build Tools 35.0.0; Java 17; Gradle 8.10.2; Android Gradle Plugin 8.7.3.
```sh
gradle :app:assembleDebug --no-daemon
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
GitHub Actions workflow builds and uploads APK as an artifact.

## Security and accuracy
No credentials are embedded. On first launch, enter the own API secret only via the secure in-app form, or use the private Vercel dashboard opened externally in a trusted browser. Android Keystore encrypts the key locally; installable debug builds are intended for testing, not Play Store release. The model API may be unavailable if host resource quotas are exceeded. Only the tools linked to actually deployed services are available; no hidden model creation, paid AI access, or unrestricted skill execution is asserted. The 235B environment is currently a control plane without provisioned GPUs.

App permissions: INTERNET only. No camera, contacts, SMS, storage or location access. No cleartext connections.
