import { it, expect } from "vitest";
import {
  getClineAccessToken,
  getClineAuthorizationHeader,
} from "../../open-sse/shared/clineAuth.js";

it("getClineAccessToken keeps an existing workos: prefix", () => {
  const token = "workos:eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
  expect(getClineAccessToken(token)).toBe(token);
  expect(getClineAccessToken(`  ${token}  `)).toBe(token);
});

it("getClineAccessToken prefixes a bare WorkOS JWT with workos:", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
  expect(getClineAccessToken(jwt)).toBe(`workos:${jwt}`);
});

it("getClineAccessToken does NOT prefix ClinePass API keys", () => {
  // ClinePass API keys are opaque strings (e.g. clp_…). Sending them as
  // `workos:clp_…` makes api.cline.bot respond 401.
  expect(getClineAccessToken("clp_1234567890abcdef")).toBe("clp_1234567890abcdef");
  expect(getClineAccessToken("sk-9r-abcdef")).toBe("sk-9r-abcdef");
  expect(getClineAccessToken("")).toBe("");
  expect(getClineAccessToken("   ")).toBe("");
  expect(getClineAccessToken(undefined)).toBe("");
  expect(getClineAccessToken(null)).toBe("");
});

it("getClineAuthorizationHeader builds a Bearer header without double prefixing", () => {
  expect(getClineAuthorizationHeader("clp_abc")).toBe("Bearer clp_abc");
  expect(getClineAuthorizationHeader("eyJpeg.eyJbG")).toBe("Bearer workos:eyJpeg.eyJbG");
  expect(getClineAuthorizationHeader("workos:eyJpeg.eyJbG")).toBe(
    "Bearer workos:eyJpeg.eyJbG",
  );
});