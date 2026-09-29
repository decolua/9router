import sqlite3, json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
db = r"C:\Users\vitou\AppData\Roaming\9router\db\data.sqlite"
c = sqlite3.connect(db)
out = Path(r"D:\Projects\9router\.scratch\_db-peek.txt")

lines = []

def redact(col, val):
    s = "" if val is None else str(val)
    secretish = any(k in col.lower() for k in ("key", "token", "secret", "password", "credential", "data"))
    if secretish and len(s) > 12:
        # for apiKeys keep prefix for identification
        if col.lower() in ("key", "apikey") or col == "key":
            return f"{s[:12]}...len{len(s)}"
        if col == "data":
            try:
                d = json.loads(s)
                # keep structure, redact values
                red = {}
                for k, v in d.items():
                    if isinstance(v, str) and len(v) > 8 and any(x in k.lower() for x in ("key", "token", "secret", "password")):
                        red[k] = f"{v[:8]}...len{len(v)}"
                    else:
                        red[k] = v
                return json.dumps(red, ensure_ascii=False)[:300]
            except Exception:
                return s[:80] + f"...len{len(s)}"
        return f"{s[:10]}...len{len(s)}"
    return s[:200]

for t in ("apiKeys", "combos", "providerNodes"):
    cols = [r[1] for r in c.execute(f"PRAGMA table_info({t})")]
    lines.append(f"\n== {t} cols={cols}")
    rows = c.execute(f"SELECT * FROM {t}").fetchall()
    lines.append(f"count={len(rows)}")
    for row in rows:
        parts = [f"{col}={redact(col, val)}" for col, val in zip(cols, row)]
        lines.append(" | ".join(parts))

# also find apinex connections
lines.append("\n== providerConnections matching apinex/openai-compatible")
cols = [r[1] for r in c.execute("PRAGMA table_info(providerConnections)")]
for row in c.execute("SELECT * FROM providerConnections"):
    d = dict(zip(cols, row))
    blob = (d.get("provider") or "") + (d.get("name") or "") + (d.get("data") or "")
    if "apinex" in blob.lower() or "openai-compatible" in (d.get("provider") or "").lower():
        parts = [f"{col}={redact(col, val)}" for col, val in d.items()]
        lines.append(" | ".join(parts))

text = "\n".join(lines)
out.write_text(text, encoding="utf-8")
print(f"wrote {out} ({len(text)} chars)")
# also extract raw api key values for e2e use into a separate secrets file
keys = c.execute("SELECT id, name, key FROM apiKeys").fetchall()
sec = Path(r"D:\Projects\9router\.scratch\apinex.env")
env = sec.read_text(encoding="utf-8") if sec.exists() else ""
# pick first active-looking key
if keys:
    kid, name, key = keys[0]
    print(f"apiKeys found: {len(keys)}; first name={name!r} prefix={key[:12]} len={len(key)}")
    # update NINEROUTER_KEY in env
    lines_env = []
    found = False
    for line in env.splitlines():
        if line.startswith("NINEROUTER_KEY="):
            lines_env.append(f"NINEROUTER_KEY={key}")
            found = True
        else:
            lines_env.append(line)
    if not found:
        lines_env.append(f"NINEROUTER_KEY={key}")
    if "ROUTER_BASE=" not in env:
        lines_env.append("ROUTER_BASE=https://router-uz2an.sevalla.app")
    sec.write_text("\n".join(lines_env) + "\n", encoding="utf-8")
    print("updated apinex.env with NINEROUTER_KEY from local db")
else:
    print("NO apiKeys in local db")
