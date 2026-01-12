# 9Router Test Suite

Automated tests for security fixes using **Vitest** (API tests) and **Playwright** (browser tests).

---

## Quick Start

```bash
# Run all security API tests
npm run test:security

# Run all browser tests
npm test:browser

# Run all tests (API + browser)
npm run test:all

# Run tests in watch mode (TDD)
npm run test:watch

# Run tests with UI
npm run test:ui

# Run with coverage
npm run test:coverage
```

---

## Test Structure

```
tests/
├── security/           # API/Unit tests (Vitest)
│   ├── fix2-jwt-secret.test.js
│   ├── fix5-api-key-secret.test.js
│   └── ...
├── browser/            # Browser tests (Playwright)
│   ├── fix4-cors.spec.js
│   ├── fix6-rate-limiting.spec.js
│   └── fix7-secure-cookies.spec.js
├── helpers/            # Test utilities
│   └── server.js       # Server management helpers
└── setup.js            # Global test setup
```

---

## Test Coverage by Fix

| Fix # | Branch | Test File | Type | Status |
|-------|--------|-----------|------|--------|
| 1 | security/fix-oauth-secrets | ⏳ TODO | API | Pending |
| 2 | security/require-jwt-secret | ✅ fix2-jwt-secret.test.js | API | Ready |
| 3 | security/remove-default-password | ⏳ TODO | API | Pending |
| 4 | security/restrict-cors | ✅ fix4-cors.spec.js | Browser | Ready |
| 5 | security/require-api-key-secret | ✅ fix5-api-key-secret.test.js | API | Ready |
| 6 | security/implement-rate-limiting | ✅ fix6-rate-limiting.spec.js | Browser | Ready |
| 7 | security/always-secure-cookies | ✅ fix7-secure-cookies.spec.js | Browser | Ready |
| 8 | security/require-machine-id-salt | ⏳ TODO | API | Pending |

---

## Running Tests for Specific Fix

### Checkout Branch and Run Tests

```bash
# Example: Test Fix 2 (JWT_SECRET)
git checkout security/require-jwt-secret
npm run test:security -- fix2-jwt-secret

# Example: Test Fix 4 (CORS)
git checkout security/restrict-cors
npm run test:browser -- fix4-cors

# Example: Test Fix 7 (Secure Cookies)
git checkout security/always-secure-cookies
npm run test:browser -- fix7-secure-cookies
```

---

## Writing New Tests

### API Test (Vitest)

```javascript
// tests/security/my-fix.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, apiRequest } from '../helpers/server.js';

describe('My Security Fix', () => {
  let server;

  beforeAll(async () => {
    server = await startServer({
      MY_ENV_VAR: 'value'
    });
  });

  afterAll(async () => {
    await stopServer(server);
  });

  it('should do something', async () => {
    const response = await apiRequest('/api/endpoint');
    expect(response.status).toBe(200);
  });
});
```

### Browser Test (Playwright)

```javascript
// tests/browser/my-fix.spec.js
import { test, expect } from '@playwright/test';

test.describe('My Browser Test', () => {
  test('should do something in browser', async ({ page }) => {
    await page.goto('http://localhost:3000');

    const element = await page.locator('button');
    await element.click();

    await expect(page).toHaveURL('/new-page');
  });
});
```

---

## Test Utilities

### Server Helpers

```javascript
import { startServer, stopServer, apiRequest } from '../helpers/server.js';

// Start server with custom environment
const server = await startServer({
  JWT_SECRET: 'custom_secret',
  PORT: 3001
});

// Make API request
const response = await apiRequest('/api/endpoint', {
  method: 'POST',
  body: JSON.stringify({ data: 'value' })
});

// Stop server
await stopServer(server);
```

---

## Environment Variables for Tests

Tests automatically set:
- `NODE_ENV=test`

You can override in tests:
```javascript
beforeAll(async () => {
  server = await startServer({
    JWT_SECRET: 'test_secret_32_characters_long',
    API_KEY_SECRET: 'test_api_key_secret_32_chars',
    MACHINE_ID_SALT: 'test_salt_16chars'
  });
});
```

---

## Debugging Tests

### Vitest (API Tests)

```bash
# Run single test file
npm run test -- fix2-jwt-secret

# Run in watch mode
npm run test:watch

# Run with UI debugger
npm run test:ui

# Run with verbose output
DEBUG=* npm run test
```

### Playwright (Browser Tests)

```bash
# Run in headed mode (see browser)
npx playwright test --headed

# Run specific test
npx playwright test fix4-cors

# Debug mode (step through)
npx playwright test --debug

# Show trace viewer
npx playwright show-trace
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Security Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      - run: npm install
      - run: npm run test:all
        env:
          JWT_SECRET: ${{ secrets.JWT_SECRET_TEST }}
          API_KEY_SECRET: ${{ secrets.API_KEY_SECRET_TEST }}
```

---

## Common Issues

### Issue: "Server failed to start"
**Solution**: Make sure required environment variables are set:
```javascript
server = await startServer({
  JWT_SECRET: 'a'.repeat(32),
  API_KEY_SECRET: 'b'.repeat(32)
});
```

### Issue: "Port 3000 already in use"
**Solution**: Stop existing server:
```bash
pkill -f "next dev"
# Or
lsof -ti:3000 | xargs kill
```

### Issue: "Tests timeout"
**Solution**: Increase timeout in test:
```javascript
it('my test', async () => {
  // test code
}, { timeout: 60000 }); // 60 seconds
```

---

## Test Best Practices

1. **Clean Up**: Always stop servers in `afterAll`
2. **Isolation**: Each test should be independent
3. **Environment**: Set required env vars for each test
4. **Assertions**: Use specific, meaningful assertions
5. **Timeouts**: Set appropriate timeouts for slow operations
6. **Parallel**: Tests should be able to run in parallel

---

## Next Steps

- [ ] Add tests for Fix 1 (OAuth Secrets)
- [ ] Add tests for Fix 3 (Default Password)
- [ ] Add tests for Fix 8 (Machine ID Salt)
- [ ] Add CI/CD integration
- [ ] Add code coverage reporting
- [ ] Add performance benchmarks
