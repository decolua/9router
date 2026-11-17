// Self-check for the WARP hop engine's pure logic. Plain node:
//   node tests/warp-hopper.test.mjs
import assert from "node:assert/strict";
import { sameBlock, isLimitLike } from "../src/lib/warp/index.js";

// sameBlock: IPv6 /64 groups, IPv4 /24, mixed families are different blocks.
assert.equal(sameBlock("2606:4700:110:8b36::1", "2606:4700:110:8b36::9"), true, "same /64");
assert.equal(sameBlock("2606:4700:110:8b36::1", "2606:4700:110:8b37::1"), false, "different /64");
assert.equal(sameBlock("1.2.3.4", "1.2.3.99"), true, "same /24");
assert.equal(sameBlock("1.2.3.4", "1.2.4.4"), false, "different /24");
assert.equal(sameBlock("1.2.3.4", "2606:4700::1"), false, "mixed families");
assert.equal(sameBlock(null, "1.2.3.4"), false, "null handling");
assert.equal(sameBlock("", ""), false, "empty handling");

// isLimitLike: 429 always; limit wording without 429; billing 402 and
// request-shape 403 FreeTierError are NOT hop material.
assert.equal(isLimitLike(429, ""), true, "429");
assert.equal(isLimitLike(429, "FreeUsageLimitError: you have used up your free limit"), true, "429 + text");
assert.equal(isLimitLike(500, "you have used up your free usage limit"), true, "usage limit text, no 429");
assert.equal(isLimitLike(503, "Too Many Requests upstream"), true, "too many requests text");
assert.equal(isLimitLike(403, "FreeTierError"), false, "403 FreeTierError is not an IP limit");
assert.equal(isLimitLike(402, "billing"), false, "402 billing");
assert.equal(isLimitLike(500, "overloaded"), false, "capacity wording is not a limit");

console.log("warp-hopper.test.mjs: all assertions passed");
