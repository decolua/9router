from pathlib import Path

env = Path(r"D:/Projects/9router/.env").read_text(encoding="utf-8")
for line in env.splitlines():
    if line.startswith("INITIAL_PASSWORD="):
        v = line.split("=", 1)[1].strip().strip('"').strip("'")
        Path(r"D:/Projects/9router/.scratch/_login.secret").write_text(v, encoding="utf-8")
        print("password_len", len(v))
        break
else:
    print("NO_PASSWORD")
