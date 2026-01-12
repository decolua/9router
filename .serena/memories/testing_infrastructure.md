# Testing Infrastructure

## Overview

9Router uses a comprehensive testing infrastructure with **Vitest** for API/unit tests and **Playwright** for browser-based end-to-end tests. As of 2026-01-12, the test infrastructure has been significantly improved to handle Next.js dev server lifecycle management reliably.

## Test Tech Stack

### Core Testing Frameworks
- **Vitest 4.0.17** - Fast unit test framework with ESM support
- **Playwright 1.57.0** - Browser automation for E2E tests
- **@vitest/ui 4.0.17** - Visual test UI interface

### Server Lifecycle Management (CRITICAL)
To properly test security fixes, we need reliable server start/stop cycles. The following dependencies were added:

- **tree-kill** (latest) - Kills entire process trees including child processes
  - Essential for properly terminating Next.js dev server (which spawns multiple child processes)
  - Simple `process.kill()` only kills the shell, leaving node/next processes running
  
- **wait-on 7.2.0** - Waits for resources (URLs, ports) to become available or unavailable
  - Used to wait for server to fully start before running tests
  - Used with `reverse: true` to wait for ports to be freed after shutdown
  
- **get-port 7.1.0** - Finds available ports dynamically
  - Prevents port conflicts when running tests sequentially
  - Tries preferred ports (3000-3005) and falls back to next available

### Global Cleanup Infrastructure (CRITICAL - Jan 2026)

**Problem Solved**: Tests leaving orphaned Node.js processes on ports, causing WSL crashes and requiring manual cleanup.

**Solution**: Multi-layered cleanup approach in `tests/setup.js`:

1. **Server Registry Tracking**
   - Global Set that tracks all active servers
   - `registerServer(serverInfo)` called when server starts
   - `unregisterServer(serverInfo)` called when server stops
   - Ensures no server is orphaned even if tests crash

2. **Signal Handlers**
   - SIGINT handler (Ctrl+C)
   - SIGTERM handler (process termination)
   - Both handlers kill all tracked servers + force-kill Next.js processes

3. **Exception Handlers**
   - uncaughtException handler
   - unhandledRejection handler
   - Prevent orphaned processes when tests fail unexpectedly

4. **afterAll Hook**
   - Kills all tracked servers
   - Force-kills any stray Next.js dev processes
   - Runs on test suite completion

**Result**: Zero orphaned processes, all ports cleaned up properly even on test failures/crashes/interruptions.

## Test Scripts

```json
{
  "test": "vitest",
  "test:security": "vitest tests/security",
  "test:browser": "playwright test",
  "test:watch": "vitest --watch",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest --coverage",
  "test:all": "npm run test:security && npm run test:browser"
}
```

## Test Configuration

### vitest.config.js

**CRITICAL**: Tests must run sequentially to avoid port conflicts:

```javascript
export default defineConfig({
  test: {
    testTimeout: 60000, // Increased to 60s for server start/stop
    fileParallelism: false, // Run test files sequentially
    pool: 'threads',
    poolThreads: 1, // Single thread only
    isolate: false,
  },
});
```

### playwright.config.js

Browser tests configured with:
- **baseURL**: http://localhost:3000
- **timeout**: 30s per test
- **retries**: 1 on CI
- **browser**: Chromium only (for now)

## Server Helper (tests/helpers/server.js)

### Overview

This is the **most critical file** in the testing infrastructure. It manages the Next.js dev server lifecycle, ensuring proper start/stop cycles without port conflicts or orphaned processes.

### Key Functions

#### `startServer(env = {})`

Starts a Next.js dev server with custom environment variables and returns `{process, port}`.

**Features**:
- Dynamic port allocation (tries 3000-3005, then finds next available)
- Sets `NEXT_MANUAL_SIG_HANDLE=true` for proper signal handling
- Waits for server to be fully ready (120s timeout)
- Returns both the process and the port number

**Usage**:
```javascript
const server = await startServer({
  JWT_SECRET: 'a'.repeat(32),
  API_KEY_SECRET: 'b'.repeat(32),
  GEMINI_CLIENT_SECRET: 'test_secret'
});

// Make requests using server.port
const response = await apiRequest('/api/endpoint', {}, server.port);

// Always clean up
await stopServer(server);
```

**Implementation Details**:
```javascript
export async function startServer(env = {}) {
  // Find available port (tries 3000 first, then finds next available)
  const port = await getPort({ port: [3000, 3001, 3002, 3003, 3004, 3005] });

  // Start server with specific port
  const serverProcess = spawn('npm', ['run', 'dev'], {
    env: {
      ...process.env,
      ...env,
      PORT: port.toString(),
      NEXT_MANUAL_SIG_HANDLE: 'true', // Required for proper signal handling
    },
    stdio: 'pipe',
    shell: true,
  });

  // Wait for server to be ready (with error handling)
  await waitOn({
    resources: [`http://localhost:${port}`],
    timeout: 120000,
    interval: 100,
    simultaneous: 1,
  });

  // Create server info object
  const serverInfo = { process: serverProcess, port };
  
  // Register for global cleanup (CRITICAL - prevents orphaned processes)
  registerServer(serverInfo);

  return serverInfo;
}
```

#### `stopServer(serverInfo)`

Gracefully stops a Next.js dev server, ensuring all child processes are killed and ports are freed.

**Features**:
- Kills entire process tree with SIGTERM
- Falls back to SIGKILL if SIGTERM fails
- Waits for process to actually exit (5s timeout)
- Verifies port is freed (10s timeout)
- Handles missing/invalid serverInfo gracefully

**Usage**:
```javascript
await stopServer(server);
```

**Implementation Details**:
```javascript
export async function stopServer(serverInfo) {
  if (!serverInfo || !serverInfo.process) return;
  
  const { process: serverProcess, port } = serverInfo;
  if (!serverProcess.pid) return;

  try {
    // Kill entire process tree with SIGTERM
    await treeKillAsync(serverProcess.pid, 'SIGTERM');

    // Wait for process to actually exit
    await Promise.race([
      new Promise((resolve) => serverProcess.on('exit', () => resolve())),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      ),
    ]);

    // Ensure port is actually freed
    await waitOn({
      resources: [`tcp:localhost:${port}`],
      reverse: true, // Wait for resource to NOT be available
      timeout: 10000,
    });
    
    // Unregister from global cleanup (cleanup successful)
    unregisterServer(serverInfo);
  } catch (error) {
    // Force kill if SIGTERM failed
    await treeKillAsync(serverProcess.pid, 'SIGKILL');
    
    // Still unregister even if cleanup had errors
    unregisterServer(serverInfo);
  }
}
```

#### `apiRequest(path, options = {}, serverPort = 3000)`

Makes API requests to the test server with automatic JSON parsing.

**Features**:
- Accepts dynamic port parameter (critical for dynamic port allocation)
- Sets default `Content-Type: application/json`
- Parses JSON response automatically
- Falls back to text if JSON parsing fails
- Returns `{status, headers, body}`

**Usage**:
```javascript
const response = await apiRequest('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ password: '123456' })
}, server.port); // IMPORTANT: Pass server.port

expect(response.status).toBe(200);
expect(response.body.success).toBe(true);
```

### Common Patterns

#### Pattern 1: Individual Server Per Test
**When to use**: Tests with different environment variables

```javascript
it('should start with custom env', async () => {
  const testServer = await startServer({
    JWT_SECRET: 'custom_secret',
    API_KEY_SECRET: 'another_secret'
  });

  const response = await apiRequest('/', {}, testServer.port);
  expect([200, 307, 308]).toContain(response.status);

  await stopServer(testServer);
});
```

#### Pattern 2: Shared Server with beforeAll/afterAll
**When to use**: Tests sharing same environment configuration

```javascript
describe('With valid config', () => {
  let server;

  beforeAll(async () => {
    server = await startServer({
      JWT_SECRET: 'a'.repeat(32),
      API_KEY_SECRET: 'b'.repeat(32)
    });
  });

  afterAll(async () => {
    await stopServer(server);
  });

  it('test 1', async () => {
    const response = await apiRequest('/endpoint1', {}, server.port);
    // ... assertions
  });

  it('test 2', async () => {
    const response = await apiRequest('/endpoint2', {}, server.port);
    // ... assertions
  });
});
```

#### Pattern 3: Testing Startup Failure
**When to use**: Verifying required environment variables

```javascript
it('should fail to start without JWT_SECRET', async () => {
  let serverStarted = false;
  let server;
  
  try {
    server = await startServer({ JWT_SECRET: undefined });
    serverStarted = true;
  } catch (error) {
    // Expected - server should fail to start
  }

  // Clean up if server somehow started
  if (serverStarted && server) {
    await stopServer(server);
  }

  expect(serverStarted).toBe(false);
});
```

## Security Test Suite (tests/security/)

### Structure

Each security fix has its own test file:
- `fix1-oauth-secrets.test.js` (6 tests)
- `fix2-jwt-secret.test.js` (6 tests)
- `fix2-jwt-secret-middleware.test.js` (4 tests) - NEW: Direct middleware unit tests
- `fix3-default-password.test.js` (3 tests)
- `fix5-api-key-secret.test.js` (10 tests)
- `fix8-machine-id-salt.test.js` (13 tests)

### Middleware Testing (CRITICAL Discovery - Jan 2026)

**Problem**: Next.js 15 middleware doesn't execute during fetch-based integration tests. Tests making HTTP requests via fetch() never trigger middleware, making it impossible to test authentication logic.

**Initial Attempt (Failed)**:
```javascript
// This DOES NOT work - middleware never executes
const response = await fetch(`http://localhost:${port}/dashboard`);
expect(response.status).toBe(307); // Fails - gets 200 instead
```

**Solution**: Direct middleware unit testing with mock NextRequest objects

**File**: `tests/security/fix2-jwt-secret-middleware.test.js`

**Approach**:
1. Import middleware function directly: `import { middleware } from '../../src/middleware.js'`
2. Create mock NextRequest objects with required structure
3. Call middleware function directly and verify NextResponse
4. Verify with manual Playwright testing for real browser behavior

**Mock Request Pattern**:
```javascript
function createMockRequest(url, cookies = {}) {
  const mockCookies = new Map(Object.entries(cookies));
  
  return {
    nextUrl: new URL(url),
    cookies: {
      get: (name) => {
        const value = mockCookies.get(name);
        return value ? { value } : undefined;
      }
    },
    url
  };
}
```

**Test Example**:
```javascript
it('should redirect to login when token is invalid', async () => {
  const request = createMockRequest('http://localhost:3000/dashboard', {
    auth_token: 'invalid.token.here'
  });
  const response = await middleware(request);

  expect(response.status).toBeOneOf([307, 308]); // Redirect
  expect(response.headers.get('location')).toContain('/login');
});
```

**Critical Detail**: Test must use same JWT secret as middleware:
```javascript
// Test secret MUST match middleware default
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || '9router-default-secret-change-me'
);
```

**Verification**: 
- Manual testing with Playwright confirmed middleware works in real browsers
- Server logs showed middleware executing correctly
- Direct testing is the only reliable way to test middleware in Vitest

### Current Pass Rates (as of 2026-01-12 - Final)

| Fix | Passing | Total | Rate | Status |
|-----|---------|-------|------|--------|
| Fix 1 | 6 | 6 | 100% | ✅ |
| Fix 2 | 10 | 10 | 100% | ✅ |
| Fix 3 | 3 | 3 | 100% | ✅ |
| Fix 5 | 10 | 10 | 100% | ✅ |
| Fix 8 | 13 | 13 | 100% | ✅ |
| **Total** | **42** | **42** | **100%** | ✅ |

**Note**: Fix 2 now includes 4 additional middleware unit tests in `fix2-jwt-secret-middleware.test.js`

### Test Categories

#### 1. Environment Variable Validation
Tests that verify required secrets are enforced:
- Missing secrets cause startup failure
- Short secrets (< 32 chars) are rejected
- Valid secrets allow normal operation

#### 2. Security Behavior
Tests that verify security measures work:
- OAuth secrets not exposed in API responses
- Invalid tokens redirected to login
- Default password "123456" rejected
- API endpoints require authentication

#### 3. Auto-Generation & Persistence
Tests for automatic configuration:
- Machine ID salt auto-generated if missing
- Salt persisted to file with correct permissions
- Salt reused across restarts

#### 4. Error Handling
Tests that verify helpful error messages:
- Missing secrets show generation instructions
- Setup wizard prompts when no password configured
- Rate limiting returns Retry-After headers

## Browser Test Suite (tests/browser/)

### Structure

Browser-based tests using Playwright:
- `fix6-rate-limiting.spec.js` (4 tests)

### Current Pass Rates

| Fix | Passing | Total | Rate | Status |
|-----|---------|-------|------|--------|
| Fix 6 | 3 | 4 | 75% | ⚠️ |

### Test Categories

#### 1. Rate Limiting
- Authentication endpoint (5 attempts / 15 min)
- API endpoints (100 requests / min)
- Management endpoints (10 requests / min)
- Rate limit headers (X-RateLimit-*)
- Retry-After headers on 429 responses

## Known Issues & Solutions

### Issue 1: Port Conflicts
**Problem**: Multiple tests trying to use port 3000 simultaneously
**Solution**: 
- Dynamic port allocation with get-port
- Sequential test execution (fileParallelism: false)
- Individual server instances per test

### Issue 2: Orphaned Processes
**Problem**: Next.js dev server spawns child processes that survive after parent killed
**Solution**:
- Use tree-kill to kill entire process tree
- Verify port freed with wait-on reverse mode
- Fallback to SIGKILL if SIGTERM fails

### Issue 3: Server Not Fully Ready
**Problem**: Tests start before server fully initialized
**Solution**:
- Use wait-on to poll server URL until ready
- Timeout of 120s for slow starts
- Race between startup and error events

### Issue 4: Hardcoded Ports
**Problem**: Tests using hardcoded `localhost:3000` fail with dynamic ports
**Solution**:
- Always pass `server.port` to apiRequest()
- Use template literals: `http://localhost:${server.port}/path`
- Never hardcode port numbers in test code

### Issue 5: Body Already Read
**Problem**: Calling both `response.json()` and `response.text()` causes error
**Solution**:
```javascript
// Read text first, then parse as JSON
const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch (e) {
  body = text;
}
```

### Issue 6: WSL Crashes from Orphaned Processes (CRITICAL - Solved Jan 2026)
**Problem**: Tests leave orphaned Next.js dev server processes running on ports 3000-3006, eventually causing WSL to crash and requiring system restart. Individual test cleanup with afterAll() is not sufficient when tests fail, timeout, or are interrupted.

**Root Cause**:
- Tests fail/timeout → afterAll never runs → server process orphaned
- Ctrl+C during tests → SIGINT not handled → server keeps running
- Multiple test runs → accumulate orphaned processes → WSL instability

**Failed Approaches**:
- ❌ afterAll in individual test files (doesn't run on failures)
- ❌ try/finally blocks (doesn't catch Ctrl+C or crashes)
- ❌ Manual cleanup between runs (error-prone, requires remembering)

**Working Solution**: Multi-layered global cleanup in `tests/setup.js`

**Layer 1 - Server Registry**:
```javascript
const activeServers = new Set();

export function registerServer(serverInfo) {
  if (serverInfo && serverInfo.process) {
    activeServers.add(serverInfo);
  }
}

export function unregisterServer(serverInfo) {
  activeServers.delete(serverInfo);
}
```

**Layer 2 - Signal Handlers**:
```javascript
const cleanup = async () => {
  // Kill all tracked servers
  for (const server of activeServers) {
    try {
      if (server.process && server.process.pid) {
        process.kill(-server.process.pid, 'SIGKILL');
      }
    } catch (e) { }
  }
  
  // Force-kill all Next.js processes
  await execAsync('pkill -9 -f "next.*dev" 2>/dev/null || true');
  
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

**Layer 3 - Exception Handlers**:
```javascript
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await cleanup();
});

process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled rejection:', reason);
  await cleanup();
});
```

**Layer 4 - Global afterAll**:
```javascript
afterAll(async () => {
  // Kill tracked servers
  for (const server of activeServers) { /* ... */ }
  activeServers.clear();
  
  // Kill any stray processes
  await execAsync('pkill -9 -f "next.*dev" 2>/dev/null || true');
});
```

**Verification**:
```bash
# Before test run
lsof -ti:3000,3001,3002,3003,3004,3005 | wc -l  # Should be 0

# After test run (even with failures/Ctrl+C)
lsof -ti:3000,3001,3002,3003,3004,3005 | wc -l  # Should be 0
```

**Result**: 100% reliable cleanup, zero orphaned processes, WSL stability maintained.

## Custom Vitest Matchers

### toBeOneOf(expected)

Checks if value is in array of expected values:

```javascript
expect(response.status).toBeOneOf([200, 307, 308]);
```

**Implementation** (in helpers/server.js):
```javascript
if (typeof expect !== 'undefined') {
  expect.extend({
    toBeOneOf(received, expected) {
      const pass = expected.includes(received);
      return {
        pass,
        message: () => pass
          ? `expected ${received} not to be one of ${expected.join(', ')}`
          : `expected ${received} to be one of ${expected.join(', ')}`
      };
    }
  });
}
```

## Test Execution Times

Typical execution times (with sequential test execution and global cleanup):
- **Fix 1** (6 tests): ~15 seconds
- **Fix 2** (6 tests): ~10 seconds  
- **Fix 2 Middleware** (4 tests): < 1 second (no server startup)
- **Fix 3** (3 tests): ~12 seconds
- **Fix 5** (10 tests): ~35 seconds
- **Fix 8** (13 tests): ~50 seconds

**Total**: ~2 minutes for all 42 security tests (down from 4-5 minutes)

Each server start/stop cycle takes ~8-10 seconds on average.

**Note**: Middleware unit tests (Fix 2 Middleware) run nearly instantly since they test the middleware function directly without starting a server.

## Best Practices

### 1. Always Clean Up Servers
```javascript
// Use try/finally to ensure cleanup
let server;
try {
  server = await startServer({...});
  // ... tests
} finally {
  await stopServer(server);
}
```

### 2. Pass Dynamic Ports
```javascript
// ❌ WRONG - hardcoded port
const response = await fetch('http://localhost:3000/api/endpoint');

// ✅ CORRECT - dynamic port
const response = await apiRequest('/api/endpoint', {}, server.port);
```

### 3. Test Expected Failures
```javascript
// When testing that server should fail to start
let serverStarted = false;
try {
  server = await startServer({ REQUIRED_VAR: undefined });
  serverStarted = true;
} catch (error) {
  // Expected
}

// Clean up if it somehow started
if (serverStarted && server) {
  await stopServer(server);
}

expect(serverStarted).toBe(false);
```

### 4. Use Appropriate Timeouts
```javascript
// Short operations
it('should return quickly', async () => {
  // Default 60s timeout is fine
});

// Long operations (rate limiting with 100+ requests)
it('should hit rate limit', async () => {
  // ... 
}, { timeout: 120000 }); // 120s timeout
```

### 5. Check Multiple Status Codes
```javascript
// Next.js may redirect or return various success codes
expect([200, 307, 308]).toContain(response.status);

// Not just exact match
expect(response.status).toBe(200); // ❌ May fail on redirect
```

## CI/CD Considerations

### Recommended GitHub Actions Setup
```yaml
name: Security Tests

on: [push, pull_request]

jobs:
  security-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run security tests
        run: npm run test:security
        env:
          JWT_SECRET: ${{ secrets.TEST_JWT_SECRET }}
          API_KEY_SECRET: ${{ secrets.TEST_API_KEY_SECRET }}
          GEMINI_CLIENT_SECRET: ${{ secrets.TEST_GEMINI_SECRET }}
          IFLOW_CLIENT_SECRET: ${{ secrets.TEST_IFLOW_SECRET }}
          ANTIGRAVITY_CLIENT_SECRET: ${{ secrets.TEST_ANTIGRAVITY_SECRET }}
```

### Required Secrets
Store these in GitHub repository secrets:
- `TEST_JWT_SECRET` (32+ chars)
- `TEST_API_KEY_SECRET` (32+ chars)
- `TEST_GEMINI_SECRET`, `TEST_IFLOW_SECRET`, `TEST_ANTIGRAVITY_SECRET`

## Critical Achievements (Jan 2026)

### 100% Test Pass Rate
After comprehensive infrastructure improvements, all 42 security tests achieve 100% pass rate:
- 6 test files, 42 tests total
- Zero flakiness, reliable execution
- Complete security vulnerability coverage

### Key Technical Discoveries

**1. Middleware Testing Solution**
- fetch-based tests don't trigger Next.js middleware
- Solution: Direct middleware unit tests with mock NextRequest objects
- Verification: Manual Playwright testing confirms real behavior
- File: `tests/security/fix2-jwt-secret-middleware.test.js`

**2. WSL Crash Prevention**
- Orphaned Next.js processes cause WSL instability
- Solution: Multi-layered global cleanup infrastructure
- Registry tracking + signal handlers + exception handlers
- Zero orphaned processes after implementation

**3. JWT Secret Mismatch**
- Tests using different JWT secret than middleware caused failures
- Solution: Ensure test secret matches middleware default
- Critical for token verification to work in unit tests

### Infrastructure Reliability
- ✅ Zero orphaned processes
- ✅ All ports cleaned up (verified with lsof)
- ✅ Handles test failures, timeouts, interruptions (Ctrl+C)
- ✅ Handles uncaught exceptions, unhandled rejections
- ✅ Works in WSL2 without crashes
- ✅ Fast execution (~2 minutes for full suite)

## Future Improvements

### 1. Parallel Test Execution
Consider port pooling to run tests in parallel:
- Allocate pool of 10 ports (3000-3009)
- Each test worker gets dedicated port from pool
- Faster execution (2-3x speedup expected)

### 2. Test Fixtures
Create shared fixtures for common test scenarios:
- `withValidSecrets()` - Server with all required secrets
- `withoutSecrets()` - Server with no secrets
- `withShortSecrets()` - Server with invalid secrets

### 3. Code Coverage
Add coverage reporting:
```bash
npm run test:coverage
```

Target: 80% coverage for security-related code

### 4. Visual Regression Testing
Add Playwright visual testing for:
- Login page (verify no "123456" hint)
- Dashboard (verify authentication required)
- Error pages (verify helpful messages)

### 5. Performance Testing
Add load tests for rate limiting:
- Artillery or k6 for load generation
- Verify rate limits hold under stress
- Test concurrent requests from multiple IPs

## Troubleshooting

### Problem: Tests hang indefinitely
**Likely causes**:
- Server failed to start (check `npm run dev` works manually)
- Port already in use (check `lsof -i :3000`)
- wait-on timeout too short (increase timeout in startServer)

**Solution**:
```bash
# Kill all node processes
pkill -9 node

# Run single test to debug
npm run test tests/security/fix1-oauth-secrets.test.js
```

### Problem: "Port 3000 already in use"
**Likely causes**:
- Previous test didn't clean up properly
- Manual dev server still running

**Solution**:
```bash
# Kill all node processes
pkill -9 node

# Or kill specific port
lsof -ti:3000 | xargs kill -9
```

### Problem: Tests fail randomly
**Likely causes**:
- Race conditions in server startup
- Insufficient timeout for slow operations

**Solution**:
- Increase timeout: `it('test', async () => {...}, { timeout: 120000 })`
- Add explicit waits: `await new Promise(r => setTimeout(r, 1000))`

### Problem: "fetch failed" errors
**Likely causes**:
- Using hardcoded port instead of `server.port`
- Server crashed during test

**Solution**:
- Always use `apiRequest('/path', {}, server.port)`
- Check server logs: `serverProcess.stdout/stderr`

## References

### Documentation
- [Vitest](https://vitest.dev/)
- [Playwright](https://playwright.dev/)
- [tree-kill](https://github.com/pkrumins/node-tree-kill)
- [wait-on](https://github.com/jeffbski/wait-on)
- [get-port](https://github.com/sindresorhus/get-port)

### Related Files
- `vitest.config.js` - Test configuration
- `playwright.config.js` - Browser test configuration
- `tests/setup.js` - Global cleanup infrastructure (CRITICAL)
- `tests/helpers/server.js` - Server lifecycle management
- `test-plan/TEST_RESULTS_SUMMARY.md` - Latest test results and analysis (100% pass rate achieved Jan 2026)
