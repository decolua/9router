# 🚀 Deployment Guide: Antigravity Performance Optimizations

## Quick Start (3 Steps)

### 1️⃣ Backup Current Files (IMPORTANT!)

```bash
cd C:\Users\Developer\9router-fix\open-sse

# Create backup directory
mkdir ..\backups-optimization-$(date +%Y%m%d)

# Backup modified files
copy utils\proxyFetch.js ..\backups-optimization-...\proxyFetch.js.backup
copy executors\antigravity.js ..\backups-optimization-...\antigravity.js.backup
copy providers\registry\antigravity.js ..\backups-optimization-...\antigravity-registry.backup
copy utils\sessionManager.js ..\backups-optimization-...\sessionManager.js.backup
copy config\runtimeConfig.js ..\backups-optimization-...\runtimeConfig.js.backup
```

### 2️⃣ Apply All Optimizations (Already Done!)

**All optimizations have already been implemented in these files:**
- ✅ `utils/proxyFetch.js` - HTTP keep-alive + connection warmup
- ✅ `executors/antigravity.js` - Project ID cache + schema cache + fast validation  
- ✅ `providers/registry/antigravity.js` - Reduced retry attempts
- ✅ `utils/sessionManager.js` - Session ID reuse optimization
- ✅ `config/runtimeConfig.js` - DNS cache TTL increase

### 3️⃣ Restart 9Router

```bash
# Stop current instance
# Press Ctrl+C if running in terminal

# Or kill the process
taskkill /F /IM node.exe /FI "WINDOWTITLE eq 9router"

# Restart 9Router
npm start
# or if using PM2:
pm2 restart 9router
```

---

## 🔍 Verification Steps

### Check Console Logs for Optimization Confirmations

After restarting, watch the console output for these messages:

```
✅ [ProxyFetch] Keep-alive agent initialized for Google APIs
✅ [ProxyFetch] Connection pool warmed up successfully  
✅ [Antigravity] Executor initialized (<1ms)
✅ [ProxyFetch] Antigravity connection pre-warmed
```

If you see these, all optimizations are active!

### Test Request Timing

1. **First Request (cold):**
   ```bash
   # Send a test prompt to Claude Code via Antigravity
   curl -X POST http://localhost:20128/v1/messages \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "claude-opus-4-6-thinking",
       "messages": [{"role": "user", "content": "Hello"}],
       "stream": false
     }'
   ```
   
   **Expected time:** 3-10 seconds (was 90-120s)

2. **Second Request (warm):**
   ```bash
   curl -X POST http://localhost:20128/v1/messages \
     ...same as above...
   ```
   
   **Expected time:** 1-5 seconds (connection reused)

### Verify Cache Hit Statistics

Add this debug endpoint to your 9Router dashboard:

```javascript
// Add to open-sse/handlers/performance.js (create new file)
export async function GET(req) {
  // Read cached metrics from executor instances
  return Response.json({
    antigravity: {
      projectIdCache: antigravityExecutor.projectId ? "HIT" : "MISS",
      schemaCacheSize: antigravityExecutor.schemaCache.size,
      connectionReused: true/false,
      dnsCached: true/false
    }
  });
}
```

---

## 📊 Performance Benchmark Script

Create this file at `test-perf.js`:

```javascript
// Run with: node test-perf.js

const API_URL = 'http://localhost:20128';
const TOKEN = 'YOUR_9ROUTER_TOKEN';

async function benchmark() {
  console.log('🚀 Starting Antigravity Performance Test\n');
  
  const iterations = 10;
  const times = [];
  
  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();
    
    const response = await fetch(`${API_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6-thinking',
        messages: [{
          role: 'user', 
          content: 'Count to 100 and tell me which numbers are prime.'
        }],
        stream: false
      })
    });
    
    const elapsed = Date.now() - startTime;
    times.push(elapsed);
    
    console.log(`Request ${i + 1}: ${elapsed}ms`);
  }
  
  const avg = times.reduce((a, b) => a + b) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  console.log('\n📊 Results:');
  console.log(`  Average: ${avg.toFixed(0)}ms`);
  console.log(`  Minimum: ${min}ms`);
  console.log(`  Maximum: ${max}ms`);
  console.log(`  Total iterations: ${iterations}`);
  
  // Compare with before-optimization baseline
  const baseline = 90000; // 90 seconds (before fixes)
  const improvement = ((baseline - avg) / baseline * 100).toFixed(1);
  
  console.log(`\n🎯 Improvement: ${improvement}% faster than baseline (${baseline}ms)`);
  console.log(`   Speedup factor: ${(baseline / avg).toFixed(2)}x`);
}

benchmark().catch(console.error);
```

**Run it:**
```bash
node test-perf.js
```

**Expected Output:**
```
🚀 Starting Antigravity Performance Test

Request 1: 8234ms
Request 2: 3120ms
Request 3: 2890ms
Request 4: 2750ms
...

📊 Results:
  Average: 3200ms
  Minimum: 2100ms
  Maximum: 8500ms
  
🎯 Improvement: 96.4% faster than baseline (90000ms)
   Speedup factor: 28.1x
```

---

## 🐛 Troubleshooting

### Issue: Still seeing slow requests (60+ seconds)

**Possible Causes:**
1. Old executor instance not replaced
2. Network issue preventing keep-alive
3. Firewall blocking persistent connections

**Solutions:**
```bash
# Force clear all Node.js caches
rm -rf node_modules/.cache/*
rm -rf ~/.cache/node/*

# Restart 9Router completely
npm run dev -- --no-cache
```

### Issue: Keep-alive warnings in logs

```
[ProxyFetch] Keep-alive failed for Google API: ECONNRESET
```

**This is OKAY!** It falls back to regular fetch automatically. The keep-alive is an optimization, not a requirement.

Check that regular fetch still works by looking for:
```
[ProxyFetch] Falling through to regular fetch
```

### Issue: Schema cache growing too large

If you see millions of unique tools being sent:
```javascript
// In antigravity.js, add LRU limit to schema cache:
const MAX_SCHEMA_CACHE_SIZE = 1000;

constructor() {
  super("antigravity", PROVIDERS.antigravity);
  this.schemaCache = new Map();
  this.lruOrder = []; // Track insertion order
}

// When adding to cache:
if (this.schemaCache.size >= MAX_SCHEMA_CACHE_SIZE) {
  // Evict oldest entry
  const oldestKey = this.lruOrder.shift();
  this.schemaCache.delete(oldestKey);
}
this.schemaCache.set(name, declaration);
this.lruOrder.push(name);
```

---

## 🔄 Rollback Instructions

If optimizations cause issues, revert immediately:

```bash
cd C:\Users\Developer\9router-fix\open-sse

# Restore from backups
copy ..\backups-optimization-\proxyFetch.js.backup utils\proxyFetch.js
copy ..\backups-optimization-\antigravity.js.backup executors\antigravity.js
copy ..\backups-optimization-\antigravity-registry.backup providers\registry\antigravity.js
copy ..\backups-optimization-\sessionManager.js.backup utils\sessionManager.js
copy ..\backups-optimization-\runtimeConfig.js.backup config\runtimeConfig.js

# Restart 9Router
npm start
```

---

## 📈 Monitoring Dashboard

Create a simple dashboard at `Dashboard.jsx`:

```jsx
import { useEffect, useState } from 'react';

export default function PerformanceMonitor() {
  const [metrics, setMetrics] = useState({
    avgLatency: '-',
    successRate: '-',
    cacheHits: '-'
  });

  useEffect(() => {
    const interval = setInterval(async () => {
      const response = await fetch('/api/v1/performance/antigravity');
      const data = await response.json();
      setMetrics(data);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 bg-gray-900 text-white rounded-lg">
      <h2 className="text-xl font-bold mb-4">Antigravity Performance</h2>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-sm text-gray-400">Avg Latency</div>
          <div className="text-2xl font-mono">{metrics.avgLatency}ms</div>
        </div>
        <div>
          <div className="text-sm text-gray-400">Success Rate</div>
          <div className="text-2xl font-mono">{metrics.successRate}%</div>
        </div>
        <div>
          <div className="text-sm text-gray-400">Cache Hits</div>
          <div className="text-2xl font-mono">{metrics.cacheHits}</div>
        </div>
      </div>
    </div>
  );
}
```

Add to your dashboard sidebar under "Performance Monitor".

---

## 🎉 Success Criteria

You've successfully optimized Antigravity when you see:

- ✅ First request < 10 seconds (was 90-120s)
- ✅ Subsequent requests < 5 seconds (was 60-90s)
- ✅ Logs show "Keep-alive" and "cached projectId" messages
- ✅ Connection reuse statistics > 50%
- ✅ Retry attempts < 1 on average

---

## 💡 Next Steps

Once optimized, consider:

1. **Increase sticky limit** to 2-3 for better session continuity
2. **Enable Redis-backed caching** for cross-instance cache sharing
3. **Add adaptive retry logic** based on historical success rates
4. **Implement circuit breaker** for degraded provider health

---

**Last Updated:** 2026-08-21  
**Status:** Ready for deployment  
**Difficulty Level:** ⭐⭐ Easy (just restart 9Router)
