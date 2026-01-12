# Security Audit Findings

**Last Updated**: 2026-01-12
**Confidence**: High
**Status**: Critical Issues Found
**Scope**: Comprehensive security audit covering authentication, secrets management, API security, input validation, and CORS

## Overview

Security audit revealed **8 critical vulnerabilities**, **3 high-priority issues**, and **5 medium-priority recommendations**. Most critical findings involve exposed secrets, weak default credentials, and overly permissive CORS configuration.

---

## Critical Vulnerabilities (Immediate Action Required)

### 1. 🔴 CRITICAL: Hard-Coded OAuth Client Secrets in Source Code

**Location**: `open-sse/config/constants.js`

**Issue**: Multiple OAuth client secrets are hard-coded directly in the source code and exposed in the public repository:

```javascript
// Line 30: Gemini
clientSecret: "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"

// Line 36: Gemini CLI  
clientSecret: "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"

// Line 48: Codex (OpenAI)
clientSecret: "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"

// Line 71: iFlow
clientSecret: "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW"

// Line 86: Antigravity
clientSecret: "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"
```

Also in:
- `src/lib/oauth/constants/oauth.js` (lines 32, 55, 68)
- `open-sse/services/usage.js` (line 17)

**Impact**: 
- Anyone with repository access can use these secrets to impersonate the application
- Compromised secrets allow unauthorized OAuth flows
- Cannot be rotated without code changes
- If these are Google Cloud OAuth secrets, attackers can obtain tokens on behalf of users

**Recommendation**:
1. **IMMEDIATELY** revoke all exposed secrets at provider consoles
2. Generate new OAuth secrets
3. Move to environment variables: `process.env.GEMINI_CLIENT_SECRET`, etc.
4. Add `.env` to `.gitignore` (if not already present)
5. Use secret scanning tools (git-secrets, TruffleHog) in CI/CD
6. Scan git history to remove exposed secrets from all commits

**References**:
- `open-sse/config/constants.js:29-36, 47-48, 70-71, 85-86`
- `src/lib/oauth/constants/oauth.js:32, 55, 68`
- `open-sse/services/tokenRefresh.js:33, 122, 260, 302`

---

### 2. 🔴 CRITICAL: Default JWT Secret Allows Token Forgery

**Location**: `src/middleware.js:4-5`, `src/app/api/auth/login/route.js:7-8`

**Issue**: JWT signing secret defaults to a weak, publicly known value:

```javascript
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);
```

**Impact**:
- Attackers can forge valid JWT tokens if `JWT_SECRET` environment variable is not set
- Bypass authentication completely
- Gain unauthorized access to dashboard and protected routes
- No detection mechanism for forged tokens

**Recommendation**:
1. **REQUIRE** `JWT_SECRET` environment variable at startup
2. Fail fast if not provided:
   ```javascript
   if (!process.env.JWT_SECRET) {
     throw new Error("JWT_SECRET environment variable is required");
   }
   ```
3. Generate strong secrets: `openssl rand -base64 32`
4. Add secret validation on application startup
5. Implement JWT key rotation strategy

**References**:
- `src/middleware.js:4-5`
- `src/app/api/auth/login/route.js:7-8`

---

### 3. 🔴 CRITICAL: Default Password '123456'

**Location**: `src/app/api/auth/login/route.js:16-21`

**Issue**: Application defaults to weak password '123456' if no password is configured:

```javascript
// Default password is '123456' if not set
const storedHash = settings.password;

let isValid = false;
if (!storedHash) {
  isValid = password === "123456";  // Plain text comparison!
}
```

**Impact**:
- Easy brute force attack on fresh installations
- Well-known default credential
- Allows unauthorized dashboard access
- Users may not realize they need to change it

**Recommendation**:
1. **FORCE** password setup on first run (setup wizard)
2. Reject weak passwords (implement password strength policy)
3. Add password change prompt on first successful login with default
4. Log authentication attempts (rate limiting - see Issue #6)
5. Display warning banner if default password is still in use

**References**:
- `src/app/api/auth/login/route.js:16-24`

---

### 4. 🔴 CRITICAL: Overly Permissive CORS Configuration

**Location**: Multiple API routes

**Issue**: CORS configured to allow ALL origins (`*`) on sensitive endpoints:

```javascript
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};
```

**Affected Endpoints**:
- `/api/v1/chat/completions` - Main chat endpoint
- `/api/v1/messages` - Messages endpoint  
- `/api/v1/responses` - Responses endpoint
- `/api/v1/messages/count_tokens` - Token counting
- `/api/v1beta/models` - Model listing
- `/api/tags` - Tags endpoint

**Impact**:
- Any website can make requests to 9Router API
- CSRF attacks possible (though mitigated by API key requirement)
- Cross-origin resource leakage
- Enables credential theft from other origins
- Data exfiltration via malicious websites

**Recommendation**:
1. **Whitelist** specific origins:
   ```javascript
   const ALLOWED_ORIGINS = [
     "http://localhost:3000",
     "https://9router.com",
     process.env.ALLOWED_ORIGIN
   ].filter(Boolean);
   
   const origin = request.headers.get("origin");
   if (ALLOWED_ORIGINS.includes(origin)) {
     headers["Access-Control-Allow-Origin"] = origin;
   }
   ```
2. For public API endpoints requiring broad access, implement:
   - Origin validation
   - Rate limiting per origin
   - API key requirement
   - Request signature verification
3. Remove wildcard from `Access-Control-Allow-Headers`
4. Implement proper CSRF tokens for state-changing operations

**References**:
- `src/app/api/v1/chat/completions/route.js:24-26`
- `src/app/api/v1/messages/route.js` (similar)
- `src/app/api/v1/responses/route.js` (similar)
- `src/app/api/v1/messages/count_tokens/route.js:1-4`

---

### 5. 🟠 HIGH: Default API Key Secret

**Location**: `src/shared/utils/apiKey.js:3`

**Issue**: API key HMAC secret defaults to weak value:

```javascript
const API_KEY_SECRET = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";
```

**Impact**:
- API keys can be forged if secret is not configured
- HMAC verification becomes useless
- Attackers can generate valid-looking API keys

**Recommendation**:
1. Require `API_KEY_SECRET` environment variable
2. Generate strong secret: `openssl rand -base64 32`
3. Validate secret length (minimum 32 characters)

**References**:
- `src/shared/utils/apiKey.js:3`
- `src/shared/utils/apiKey.js:22` (HMAC generation)

---

### 6. 🟠 HIGH: No Rate Limiting

**Location**: All API routes

**Issue**: No rate limiting detected on any API endpoints, including:
- Authentication endpoint (`/api/auth/login`)
- Chat endpoints (`/api/v1/chat/completions`)
- Provider management endpoints

**Impact**:
- Brute force attacks on authentication
- API abuse and DoS
- Resource exhaustion
- Excessive upstream API costs

**Recommendation**:
1. Implement rate limiting using middleware or library (e.g., `express-rate-limit`)
2. Different limits for different endpoint types:
   - Auth: 5 attempts per 15 minutes per IP
   - Chat: 100 requests per minute per API key
   - Provider CRUD: 60 requests per minute per user
3. Return `429 Too Many Requests` with `Retry-After` header
4. Log rate limit violations for security monitoring

**Example**:
```javascript
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: "Too many login attempts, please try again later"
});
```

---

### 7. 🟠 HIGH: Secure Cookie Flag Only in Production

**Location**: `src/app/api/auth/login/route.js:35`

**Issue**: Cookies only marked as secure in production:

```javascript
cookieStore.set("auth_token", token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",  // ❌ Not secure in dev
  sameSite: "lax",
  path: "/",
});
```

**Impact**:
- JWT tokens transmitted over HTTP in development
- Man-in-the-middle attacks in non-production environments
- Developers may accidentally deploy with `NODE_ENV !== "production"`

**Recommendation**:
1. Always use secure flag:
   ```javascript
   secure: true,
   ```
2. For local development, use HTTPS (e.g., `mkcert` for local certs)
3. Add startup warning if HTTPS is not enabled
4. Consider using `sameSite: "strict"` for better CSRF protection

**References**:
- `src/app/api/auth/login/route.js:33-38`

---

### 8. 🟠 HIGH: Default Machine ID Salt

**Location**: `src/shared/utils/machineId.js:12`

**Issue**: Machine ID salt defaults to weak value:

```javascript
const saltValue = salt || process.env.MACHINE_ID_SALT || 'endpoint-proxy-salt';
```

**Impact**:
- Predictable machine IDs
- Easier to forge machine identities
- Cloud sync security weakened

**Recommendation**:
1. Require `MACHINE_ID_SALT` or generate unique per-installation
2. Store generated salt securely in database on first run
3. Validate salt complexity

**References**:
- `src/shared/utils/machineId.js:12`

---

## Medium Priority Issues

### 9. 🟡 MEDIUM: Insufficient Input Validation on API Routes

**Issue**: Limited input validation on dynamic route parameters and request bodies.

**Example**: `src/app/api/providers/[id]/route.js`
- `id` parameter not validated (UUID format check)
- Request body fields not validated for type/format

**Recommendation**:
1. Validate all dynamic route parameters
2. Implement request body schema validation (e.g., Zod, Joi)
3. Sanitize all user inputs
4. Return proper error messages for invalid input

---

### 10. 🟡 MEDIUM: Error Messages May Leak Information

**Issue**: Some error responses include detailed error messages:

```javascript
return NextResponse.json({ error: error.message }, { status: 500 });
```

**Impact**:
- Stack traces may reveal file paths, internal logic
- Helps attackers understand system internals

**Recommendation**:
1. Generic error messages for production
2. Log detailed errors server-side only
3. Different error handling for development vs. production

---

### 11. 🟡 MEDIUM: No Request Logging for Security Events

**Issue**: No centralized security event logging detected for:
- Failed authentication attempts
- API key validation failures
- Suspicious activity patterns

**Recommendation**:
1. Implement security event logging
2. Log to secure, append-only location
3. Monitor for suspicious patterns
4. Alert on anomalies (multiple failed logins, etc.)

---

### 12. 🟡 MEDIUM: Database File Permissions

**Location**: `src/lib/localDb.js:36-38`

**Issue**: Database directory created with default permissions:

```javascript
if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
```

**Recommendation**:
1. Set restrictive permissions: `fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })`
2. Verify file permissions on startup
3. Encrypt sensitive data at rest (OAuth tokens, API keys)

**References**:
- `src/lib/localDb.js:36-38`

---

### 13. 🟡 MEDIUM: Token Expiry Buffer May Be Too Short

**Location**: `open-sse/services/tokenRefresh.js:4`

**Issue**: 5-minute token refresh buffer:

```javascript
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
```

**Recommendation**:
- Consider 10-15 minute buffer for reliability
- Handle edge cases where refresh fails near expiry
- Implement graceful degradation if token refresh fails

---

## Positive Security Practices Observed

✅ **Good: PKCE OAuth Flow**
- Proper PKCE implementation in `src/lib/oauth/`
- Code verifier stored securely
- State parameter used correctly

✅ **Good: Password Hashing with bcrypt**
- `src/app/api/auth/login/route.js:23` uses bcrypt for password comparison
- Proper async usage

✅ **Good: httpOnly Cookie Flag**
- JWT stored in httpOnly cookie (prevents XSS access)
- `src/app/api/auth/login/route.js:34`

✅ **Good: Token Auto-Refresh**
- Proactive token refresh before expiry
- Multiple retry attempts with exponential backoff
- `open-sse/services/tokenRefresh.js:523-541`

✅ **Good: Sensitive Field Filtering**
- API keys and tokens removed from responses
- `src/app/api/providers/[id]/route.js:17-21`

---

## Security Checklist Recommendations

### Immediate Actions (Critical - Do First)
- [ ] Revoke all exposed OAuth client secrets
- [ ] Generate new secrets and move to environment variables
- [ ] Require JWT_SECRET environment variable (fail fast if missing)
- [ ] Enforce password change on first login with default password
- [ ] Fix CORS to whitelist specific origins
- [ ] Implement rate limiting on authentication endpoints

### Short-term Actions (High Priority - This Week)
- [ ] Add rate limiting to all API endpoints
- [ ] Always use secure cookie flag
- [ ] Implement request body validation
- [ ] Add security event logging
- [ ] Set restrictive database file permissions
- [ ] Scan git history for exposed secrets

### Medium-term Actions (Medium Priority - This Month)
- [ ] Implement input validation framework (Zod/Joi)
- [ ] Generic error messages in production
- [ ] Security monitoring and alerting
- [ ] Penetration testing
- [ ] Security headers (CSP, HSTS, X-Frame-Options)
- [ ] Dependency vulnerability scanning (npm audit, Snyk)

### Long-term Actions (Ongoing)
- [ ] Security training for developers
- [ ] Regular security audits
- [ ] Bug bounty program
- [ ] Automated secret scanning in CI/CD
- [ ] Consider encryption at rest for sensitive data
- [ ] Implement 2FA for dashboard access

---

## Compliance & Standards

**OWASP Top 10 (2021) Issues Found**:
1. ✅ **A01:2021 - Broken Access Control**: Weak authentication (default password)
2. ✅ **A02:2021 - Cryptographic Failures**: Hard-coded secrets, weak JWT secret
3. ✅ **A05:2021 - Security Misconfiguration**: CORS wildcard, insecure cookies in dev
4. ✅ **A07:2021 - Identification and Authentication Failures**: No rate limiting, weak defaults

**CWE (Common Weakness Enumeration) Matches**:
- CWE-798: Use of Hard-coded Credentials (OAuth secrets)
- CWE-259: Use of Hard-coded Password (default password '123456')
- CWE-284: Improper Access Control (CORS wildcard)
- CWE-307: Improper Restriction of Excessive Authentication Attempts (no rate limiting)
- CWE-311: Missing Encryption of Sensitive Data (tokens in local filesystem)

---

## Testing Recommendations

**Security Testing Tools**:
1. **Static Analysis**: 
   - ESLint security plugins
   - Semgrep for pattern matching
   - SonarQube for vulnerability detection

2. **Dependency Scanning**:
   - `npm audit` (built-in)
   - Snyk
   - Dependabot (GitHub)

3. **Secret Scanning**:
   - git-secrets
   - TruffleHog
   - GitHub secret scanning

4. **Dynamic Testing**:
   - OWASP ZAP for automated scanning
   - Burp Suite for manual testing
   - Postman security tests

---

## References & Resources

**Security Best Practices**:
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Next.js Security: https://nextjs.org/docs/app/building-your-application/configuring/security
- OAuth 2.0 Security: https://oauth.net/2/oauth-best-practice/
- JWT Security: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html

**Related Memories**:
- See also: architecture.md (for system architecture understanding)
- See also: tech_stack.md (for dependencies and versions)

---

## Audit Methodology

**Tools Used**:
- Serena MCP symbolic code search
- Manual code review
- Pattern matching for secrets, eval, path traversal
- OAuth flow analysis
- CORS configuration review

**Files Audited** (32 files):
- Authentication: `src/middleware.js`, `src/app/api/auth/login/route.js`
- Database: `src/lib/localDb.js`, `src/lib/usageDb.js`
- API Routes: `src/app/api/**/*.js` (18 files)
- OAuth: `src/lib/oauth/**/*.js` (8 files)
- Config: `open-sse/config/constants.js`, `src/lib/oauth/constants/oauth.js`
- Token Management: `open-sse/services/tokenRefresh.js`

**Not Audited** (out of scope for this audit):
- Frontend React components (XSS vulnerabilities)
- WebSocket security (not implemented)
- Third-party AI provider API security
- Infrastructure security (Docker, Kubernetes)
- Network security (DDoS, firewall rules)
