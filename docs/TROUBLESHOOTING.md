# Troubleshooting

Common issues and solutions for 9Router.

---

## Dashboard Issues

### Dashboard won't load on port 20128

**Cause:** Port conflict or server not started.

```bash
# Check if something else is on port 20128
lsof -i :20128

# Kill existing process if needed
kill -9 <PID>

# Restart 9router
9router
```

### Dashboard asks for password but I don't know it

**Default password:** `123456`

For local-only use, change it after first login in Settings. Before exposing the dashboard outside localhost, set a strong `INITIAL_PASSWORD` and protect `$DATA_DIR/db/data.sqlite`.

### Dashboard shows "Connection Error" for provider

1. Check provider credentials in Dashboard
2. Click "Test" to validate connection
3. Check network connectivity to provider
4. Review error details in provider status

---

## Provider Issues

### OAuth provider expired

**Automatic:** 9Router refreshes tokens automatically.

If refresh fails:

1. Dashboard → Providers → Re-authenticate
2. Complete OAuth flow again
3. Token stored and active

### API key rejected

1. Verify key is correct (no extra spaces)
2. Check provider dashboard for key status
3. Regenerate key if needed
4. Update in 9Router Dashboard

### Rate limited (429)

9Router handles this automatically:

1. Account put in cooldown
2. Next account tried (if multi-account)
3. Next combo model tried (if configured)

Manual check:

```bash
# Check provider status
curl http://localhost:20128/api/providers
```

### Provider returns 500 error

1. Check provider status page (external)
2. Retry request (transient error)
3. If persistent → fallback to next provider/model

---

## RTK Issues

### RTK not compressing content

1. Check RTK is enabled: Dashboard → Endpoint settings
2. Verify content type matches a filter
3. Enable request logs: `ENABLE_REQUEST_LOGS=true`
4. Check logs for filter errors

### Compression making content worse

RTK automatically falls back to original if compressed > original size. If you see this:

1. Check filter in `open-sse/rtk/filters/`
2. Review autodetect logic in `open-sse/rtk/autodetect.js`
3. Report bug with example content

---

## CLI Tool Issues

### CLI tool can't connect to 9Router

1. Verify endpoint: `http://localhost:20128/v1`
2. Verify API key: copy from Dashboard → Settings
3. Check 9Router is running: `curl http://localhost:20128/api/health`
4. Check firewall: port 20128 must be accessible

### Wrong model returned

1. Check model name format: `prefix/model-name`
2. Verify model exists in Dashboard → Models
3. Check combo routing if using combo name
4. Check disabled models list

### Slow responses

1. Check provider latency (external factor)
2. Check network connectivity
3. Try a cheaper/faster provider
4. Check if RTK is working (saves input tokens)

---

## Database Issues

### SQLite errors

9Router uses SQLite with better-sqlite3 (primary) and sql.js (fallback):

1. Check disk space
2. Verify DATA_DIR permissions
3. Backup: Dashboard → Settings → Backup/Restore
4. If corrupt: remove DB file and restart (will recreate)

### Data not persisting

1. Docker: verify volume mount is correct
   ```bash
   docker inspect 9router | grep Mounts
   ```
2. Check DATA_DIR env variable
3. Verify file permissions on DB directory

---

## Cloud Sync Issues

### Sync failing

1. Check cloud endpoint: `NEXT_PUBLIC_CLOUD_URL`
2. Verify API key is valid
3. Check network connectivity to cloud
4. Local runtime continues even if sync fails

### Multi-device conflict

Cloud sync uses "last write wins" for most fields. To resolve:

1. Sync from the device with correct config
2. Force sync: Dashboard → Settings → Cloud Sync → Sync Now
3. Disable sync, manually fix, re-enable

---

## Tailscale Tunnel Issues

### Tunnel not connecting

1. Check Tailscale status: `tailscale status`
2. Verify tunnel settings in Dashboard
3. Check transport protocol (UDP/TCP)
4. Test connectivity to tunnel endpoint

### Port 443 conflict

MITM server needs port 443:

1. Kill process on port 443
2. Restart 9Router (auto-resumes once per process)
3. Check MITM server card status in Dashboard

---

## Deployment Issues

### Docker build fails

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Build
docker build -t 9router .
```

### CapRover deployment fails

1. Verify `captain-definition` exists
2. Check build logs in CapRover dashboard
3. Verify environment variables in CapRover

### Production build errors

```bash
# Clean build
rm -rf .next
npm run build
```

---

## Logging and Debugging

### Enable detailed logging

```bash
# Environment variable
ENABLE_REQUEST_LOGS=true 9router
```

Logs written to `<repo>/logs/`

### Check health

```bash
curl http://localhost:20128/api/health
```

### Check version

```bash
curl http://localhost:20128/api/version
```

### Check usage

```bash
curl http://localhost:20128/api/usage
```

---

## Getting Help

- Local dashboard: http://localhost:20128/dashboard
- Fork workspace docs: `docs/`
- Upstream reference is read-only for this workspace
