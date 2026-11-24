# SceneForge Studio Android v15 (debug wrapper)

This is a **native Android WebView wrapper for the live SceneForge website**. It does not embed an offline AI model, Cerebrium GPU, or native 3D engine. Internet and the owner's Hatchable sign-in are required. The wrapper is **not yet tested on a physical Samsung Galaxy A07**.

Web editor: https://sceneforge-studio.hatchable.site
**Internet-only design tool access:** The Android wrapper now has a **Design tools** launcher for Figma and Canva. Both services open externally in the browser, outside SceneForge's privileged WebView. The launcher also links the owner's existing Canva `SceneForge Studio UI style guide` and `SceneForge cinematic VFX overlay` designs.

After a SceneForge PNG, WebM or MP4 is exported, the launcher can open Android's native share chooser for that saved file on Android 10+. Whether Canva or Figma appears as a receiving app depends on installed apps and OS support. Opening the online sites and invoking the share chooser are not equivalent to a Canva API integration, Figma API integration, automatic synchronization, or direct upload. There are no tokens embedded in the APK.

The **Ansvar security and compliance** menu entry opens Ansvar Gateway's official setup information in the external browser. Live compliance lookups are available separately through the owner's connected ChatGPT Ansvar Gateway; in-app OAuth/MCP calls have not been implemented. See [ONLINE_DESIGN_COMPLIANCE.md](ONLINE_DESIGN_COMPLIANCE.md) for security limitations.

**Offline editing:** Not included. The SceneForge website and linked design tools require internet and applicable account sign-in. The wrapper allows camera/video permission only for the trusted SceneForge origin.
Android System WebView provides the site's compositing and WebGL support where available. MediaStore attempts to save WebView-generated PNG, WebM or MP4 blob exports in Downloads/SceneForge. Actual playback and camera capture must be verified on the device.
Only PNG, WebM and MP4 data URLs with a 30 MB decoded size cap are accepted for native export. Export messages use AndroidX WebKit's origin-scoped WebMessageListener, accept only messages from the main SceneForge frame, and have no filesystem-read or command-execution capability. Browser-native downloading remains available even if the WebMessageListener feature is unavailable. The app disables cleartext requests and backup.

## Build
Requires Java 17, Android SDK 35, and Gradle 8.10.2.

```sh
cd sceneforge-android
gradle :app:assembleDebug
```

APK path: app/build/outputs/apk/debug/app-debug.apk

The GitHub Actions workflow builds the APK, checks its archive and Android signature, and uploads the debug APK as a workflow artifact. Debug signing is for sideload tests, not Google Play publication. If v14 was installed with a differently generated debug signing key, Android may require uninstalling that debug build before installing v15. The v15 APK and device operation remain unverified until the corresponding Actions workflow and phone checks pass.
