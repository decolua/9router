# 9Router — Windows Service Setup

Running 9Router as a Windows service requires one of the approaches below. The
`9router service install` command does **not** handle Windows installation
because `node-windows` is not bundled (it requires a native build step that
varies by Node version and machine architecture).

---

## Option A — node-windows

### Prerequisites

- Node.js ≥ 18 on PATH
- `node-windows` installed globally: `npm i -g node-windows`

### Install

Create a small wrapper script (e.g. `install-svc.js`) alongside your 9Router
standalone build:

```js
const { Service } = require("node-windows");

const svc = new Service({
  name: "9Router",
  description: "9Router reverse-proxy server",
  script: "C:\\path\\to\\9router-standalone\\custom-server.js",
});

svc.on("install", () => svc.start());
svc.install();
```

Run once with administrator privileges:

```bat
node install-svc.js
```

### Start / Stop / Restart / Status

After the service is installed, the CLI delegates to `net` and `sc.exe`:

```bat
9router service start
9router service stop
9router service restart
9router service status
```

Or use native Windows tools directly:

```bat
net start 9Router
net stop 9Router
sc query 9Router
```

### Uninstall

```js
const { Service } = require("node-windows");
const svc = new Service({ name: "9Router", script: "..." });
svc.on("uninstall", () => console.log("Done"));
svc.uninstall();
```

---

## Option B — sc.exe (no extra dependencies)

### Prerequisites

- Node.js ≥ 18 on PATH
- An administrator command prompt

### Install

```bat
sc create 9Router ^
  binPath= "node C:\path\to\9router-standalone\custom-server.js" ^
  DisplayName= "9Router" ^
  start= auto
```

> **Note:** The space after `binPath=` and `start=` is required by `sc.exe`.

Set the service to auto-restart on failure (optional but recommended):

```bat
sc failure 9Router reset= 60 actions= restart/5000/restart/10000/restart/30000
```

### Start / Stop / Status

```bat
sc start 9Router
sc stop 9Router
sc query 9Router
```

### Uninstall

```bat
sc stop 9Router
sc delete 9Router
```

---

## Option C — Docker / CI

If you prefer not to manage a Windows service, run 9Router in a container:

```bat
docker run -d --restart unless-stopped ^
  -p 3000:3000 ^
  -e PORT=3000 ^
  bloodf/9router:latest
```

For CI pipelines, start the server as a background process in your workflow
step and stop it after the test suite completes.

---

## Troubleshooting

### EACCES / Access Denied

The service runner needs permission to bind to privileged ports (< 1024) or
to write to protected directories. Run the service account with appropriate
permissions, or use a port ≥ 1024 and place 9Router behind a reverse proxy
(e.g. IIS, nginx for Windows, or Caddy).

### Port Already in Use

Check what is listening on the target port:

```bat
netstat -ano | findstr :<PORT>
tasklist | findstr <PID>
```

Change the port via the `PORT` environment variable or your 9Router config
before starting the service.

### PATH / Node Not Found

The service host (`svchost.exe` / `node-windows` wrapper) may not inherit your
user PATH. Use the full absolute path to `node.exe` in the `binPath` or
`script` field:

```bat
sc create 9Router binPath= "C:\Program Files\nodejs\node.exe C:\path\to\custom-server.js"
```

### Service Fails to Start (Event Log)

Open **Event Viewer → Windows Logs → Application** and filter by source
`9Router` or `Service Control Manager` for the error detail.

---

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — overall system design
- [node-windows docs](https://github.com/coreybutler/node-windows)
- Microsoft docs: [`sc.exe` syntax](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/sc-create)
