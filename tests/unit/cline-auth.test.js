import test from "node:test";
import assert from "node:assert/strict";
import {
  getClineAccessToken,
  getClineAuthorizationHeader,
} from "../../open-sse/shared/clineAuth.js";

test("getClineAccessToken keeps an existing workos: prefix", () => {
  const token = "workos:eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
  assert.equal(getClineAccessToken(token), token);
  assert.equal(getClineAccessToken(`  ${token}  `), token);
});

test("getClineAccessToken prefixes a bare WorkOS JWT with workos:", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
  assert.equal(getClineAccessToken(jwt), `workos:${jwt}`);
});

test("getClineAccessToken does NOT prefix ClinePass API keys", () => {
  // ClinePass API keys are opaque strings (e.g. clp_…). Sending them as
  // `workos:clp_…` makes api.cline.bot respond 401.
  assert.equal(getClineAccessToken("clp_1234567890abcdef"), "clp_1234567890abcdef");
  assert.equal(getClineAccessToken("sk-9r-abcdef"), "sk-9r-abcdef");
  assert.equal(getClineAccessToken(""), "");
  assert.equal(getClineAccessToken("   "), "");
  assert.equal(getClineAccessToken(undefined), "");
  assert.equal(getClineAccessToken(null), "");
});

test("getClineAuthorizationHeader builds a Bearer header without double prefixing", () => {
  assert.equal(getClineAuthorizationHeader("clp_abc"), "Bearer clp_abc");
  assert.equal(
    getClineAuthorizationHeader("eyJpeg.eyJbG"),
    "Bearer workos:eyJpeg.eyJbG"
  );
  assert.equal(
    getClineAuthorizationHeader("workos:eyJpeg.eyJbG"),
    "Bearer workos:eyJpeg.eyJbG"
  );
});