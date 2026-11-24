# Windows control helpers

These optional PowerShell 5.1 helpers install per-user Enable/Restore launchers for a **trusted, built 9Router CLI package with `antigravity-byok-v1` support**. They do not install a provider, import API keys, download software, or copy a CA private key. First install the compatible build and configure your own provider connections in 9Router.

Before Enable, explicitly create and trust the MITM certificate through 9Router's existing setup flow. The matching local certificate/key must exist and the certificate must already be in the Windows Local Machine Root store with at least 30 days remaining. The helpers check this prerequisite read-only and never create, rotate, or install a certificate.

Create an explicitly enabled routing profile using the main BYOK guide. Primary entries use `{"target":"registered-prefix/model","label":"Your display name (BYOK)"}`; auxiliary mappings are routing strings. The profile must contain routing metadata only. The configured slots and targets belong to the user; these helpers ship no default model selection.

Preview installation from this directory:

```powershell
.\Bootstrap.ps1 -ProfilePath C:\path\to\your-profile.json -InstallRoot C:\path\to\installed\9router
```

Pass `-Apply -CreateShortcuts` after reviewing the paths to install the controls and desktop shortcuts. `-NodePath`, `-AppPath`, `-DataDir`, `-ControlDir`, and `-GatewayPort` override detection. The default control directory is `%LOCALAPPDATA%\9router\antigravity-byok`. Unknown existing files/shortcuts are never overwritten; use a new control directory for a changed build or helper release. Repeating an identical installation is safe. Installation itself never starts the App or services.

The installed `Enable.cmd` and `Restore.cmd` explicitly request Apply. Their `.ps1` counterparts default to preview and also accept `-DryRun`/`-WhatIf`. Enable checks the locally generated version/hash manifest, refuses other configured bridges and unowned port listeners, and binds services to loopback. Restore removes only this installation's tagged DNS lines and recorded, identity-checked processes, and retains uniquely named policy/hosts backups. Neither control deletes user sessions or provider credentials. App restarts use a verified same-user, non-elevated Explorer shell; otherwise the result requests a manual App launch.

Save your work and finish running App tasks before either shortcut. Switching requests a normal App close and waits up to 12 seconds. It never force-terminates an Antigravity process. If the App remains open or is waiting for an unsaved-work prompt, the result is `NeedsManualAppRestart`: close it normally and reopen it to refresh the model catalog.

The manifest detects changes to the selected installed artifacts; it does **not** authenticate the build's publisher. Use a source/build you trust. Node 22+ is recommended; older supported Node versions need 9Router's local `better-sqlite3` runtime for the read-only startup settings check. Existing saved DNS for another bridge causes a clear failure rather than changing it. These scripts intentionally do not support sharing one bridge listener among multiple tools.

Result JSON and local service logs remain under the control directory's `results` folder. Public result objects contain metadata, not credentials or prompts. Do not include generated control files, logs, database files, certificates, or results in a source distribution.

Tests:

```powershell
node --test .\tests\management.test.cjs
powershell.exe -NoProfile -File .\tests\Windows.Helpers.Tests.ps1
```

The Windows test uses a temporary fixture and never starts services, changes hosts, elevates, or creates shortcuts.
