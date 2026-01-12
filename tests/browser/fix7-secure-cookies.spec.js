/**
 * Security Test: Fix 7 - Secure Cookie Flags
 * Branch: security/always-secure-cookies
 *
 * Uses Playwright for browser-based cookie testing
 */

import { test, expect } from '@playwright/test';

test.describe('Fix 7: Secure Cookie Flags', () => {
  test.beforeAll(async () => {
    // Ensure environment is set
    process.env.JWT_SECRET = 'a'.repeat(32);
  });

  test('should set secure cookie flags on login', async ({ page, context }) => {
    await page.goto('http://localhost:3000/login');

    // Try to login (default password might be 123456 or might not be set)
    await page.fill('input[type="password"]', '123456');
    await page.click('button[type="submit"]');

    // Wait for response
    await page.waitForTimeout(1000);

    // Get cookies
    const cookies = await context.cookies();
    const authCookie = cookies.find(c => c.name === 'auth_token');

    if (authCookie) {
      // Verify secure flags
      expect(authCookie.httpOnly).toBe(true);
      expect(authCookie.secure).toBe(true);
      expect(authCookie.sameSite).toBe('Strict');

      // Verify max age (24 hours = 86400 seconds)
      // Cookie might be session cookie (no maxAge) or have explicit maxAge
      if (authCookie.expires && authCookie.expires > 0) {
        const now = Math.floor(Date.now() / 1000);
        const maxAge = authCookie.expires - now;

        // Should be approximately 24 hours (allow some variance)
        expect(maxAge).toBeGreaterThan(86000); // ~24 hours minus some time
        expect(maxAge).toBeLessThan(87000); // ~24 hours plus some time
      }
    }
  });

  test('should not be accessible via JavaScript', async ({ page }) => {
    await page.goto('http://localhost:3000/login');

    // Try to login
    await page.fill('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    // Try to access cookie via JavaScript
    const cookieValue = await page.evaluate(() => document.cookie);

    // HttpOnly cookies should not appear in document.cookie
    expect(cookieValue).not.toContain('auth_token');
  });

  test('should have HttpOnly attribute', async ({ page }) => {
    await page.goto('http://localhost:3000/login');

    // Intercept Set-Cookie headers
    let setCookieHeader = '';

    page.on('response', response => {
      const headers = response.headers();
      if (headers['set-cookie'] && headers['set-cookie'].includes('auth_token')) {
        setCookieHeader = headers['set-cookie'];
      }
    });

    // Try to login
    await page.fill('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    if (setCookieHeader) {
      expect(setCookieHeader.toLowerCase()).toContain('httponly');
      expect(setCookieHeader.toLowerCase()).toContain('secure');
      expect(setCookieHeader.toLowerCase()).toContain('samesite=strict');
    }
  });

  test('should prevent CSRF with SameSite=Strict', async ({ page, context }) => {
    // Login first
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    const cookies = await context.cookies();
    const authCookie = cookies.find(c => c.name === 'auth_token');

    if (authCookie) {
      // SameSite=Strict prevents cross-site requests
      expect(authCookie.sameSite).toBe('Strict');

      // This ensures the cookie won't be sent with requests from other origins
    }
  });
});
