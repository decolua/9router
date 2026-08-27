# Troubleshooting

Common issues and quick solutions.

---

## 1. Port 20128 Already in Use

**Error**: `EADDRINUSE: address already in use :::20128`

**Solution**:
```bash
# Find and terminate process on macOS / Linux:
lsof -i :20128
kill -9 <PID>

# Or start on another port:
9router --port 20129
```

---

## 2. Model Returns 429 (Rate Limit) or Quota Error

**Cause**: Upstream provider account has hit its rolling window or credit limit.

**Solution**:
- Create or select a **Combo** with multi-tier fallback (e.g. `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`).
- Check the dashboard quota monitor to see exact reset countdowns.

---

## 3. Tool Cannot Connect to `http://localhost:20128/v1`

**Causes & Solutions**:
- **OpenClaw / Node tools**: If IPv6 resolution causes issues with `localhost`, use `http://127.0.0.1:20128/v1` instead.
- **Docker containers**: Ensure port `-p 20128:20128` is mapped and access via host IP / `host.docker.internal`.

---

## 4. OAuth Session / Token Expired

**Solution**:
- 9Router handles automatic background token refreshes for supported providers.
- If upstream credentials were revoked, visit Dashboard → **Providers** → **Reconnect**.

---

## 5. Cannot Log In (Forgotten Password)

**Solution**:
If you forgot your custom dashboard password, reset the SQLite database or remove the saved hash:
```bash
rm ~/.9router/db/data.sqlite
```
9Router will re-initialize with the default password `123456`.
