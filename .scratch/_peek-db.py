import sqlite3

db = r"C:\Users\vitou\AppData\Roaming\9router\db\data.sqlite"
c = sqlite3.connect(db)
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("TABLES:", tables)

interesting = ("key", "combo", "provider", "node", "connect", "credential", "alias")
for t in tables:
    if not any(x in t.lower() for x in interesting):
        continue
    cols = [r[1] for r in c.execute(f"PRAGMA table_info({t})")]
    print(f"\n== {t} cols={cols}")
    try:
        rows = c.execute(f"SELECT * FROM {t} LIMIT 30").fetchall()
    except Exception as e:
        print("err", e)
        continue
    for row in rows:
        out = []
        for col, val in zip(cols, row):
            s = "" if val is None else str(val)
            secretish = any(k in col.lower() for k in ("key", "token", "secret", "password", "credential"))
            if secretish and len(s) > 8:
                out.append(f"{col}={s[:10]}...len{len(s)}")
            elif len(s) > 140:
                out.append(f"{col}={s[:100]}...len{len(s)}")
            else:
                out.append(f"{col}={s}")
        print(" | ".join(out))
