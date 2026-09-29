## Resolution

Implemented 3-second crash recovery watchdog and silent background autostart for Windows 11:

1. **Watchdog Supervisor Loop (`cli/src/cli/tray/autostart.js`)**:
   Upgraded `enableWindows` to write a persistent VBS watchdog supervisor loop:
   ```vbscript
   Set WshShell = CreateObject("WScript.Shell")
   Do
     ret = WshShell.Run("""$NodePath"" ""$CliPath"" --tray --skip-update", 0, True)
     If ret = 0 Then Exit Do
     WScript.Sleep 3000
   Loop
   ```
   - Runs hidden (`0` window style, no cmd window popups).
   - Exit code `0` (clean exit from tray menu) breaks loop cleanly.
   - Non-zero exit code (abnormal crash/kill) waits 3000ms (3s) and revives the gateway automatically.

2. **Windows Management Script (`scripts/setup-windows-autostart.ps1`)**:
   Added PowerShell management tool supporting:
   - `-Action Status`: probes running node/watchdog processes and registration status.
   - `-Action Enable`: installs watchdog to `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\9router.vbs`.
   - `-Action Disable`: removes startup script.
   - `-Action Start` / `-Action Stop`: immediate background process control.

Verified operational on Windows 11 host.
