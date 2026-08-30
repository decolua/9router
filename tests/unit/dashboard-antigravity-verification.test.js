import test from "node:test";
import assert from "node:assert/strict";

import { isValidVerificationUrl, useVerificationStore } from "../../src/store/verificationStore.js";

test("DashboardLayout antigravity verification URL validation", async (t) => {
  await t.test("allows valid accounts.google.com URL", () => {
    assert.equal(
      isValidVerificationUrl("https://accounts.google.com/signin/continue?sarp=1&continue=https://console.cloud.google.com"),
      true
    );
  });

  await t.test("rejects subdomain of accounts.google.com", () => {
    assert.equal(
      isValidVerificationUrl("https://sub.accounts.google.com/signin/continue"),
      false
    );
  });

  await t.test("rejects http url", () => {
    assert.equal(
      isValidVerificationUrl("http://accounts.google.com/signin/continue"),
      false
    );
  });

  await t.test("rejects untrusted domains", () => {
    assert.equal(isValidVerificationUrl("https://evil.com/signin"), false);
    assert.equal(isValidVerificationUrl("javascript:alert(1)"), false);
    assert.equal(isValidVerificationUrl("https://accounts.google.com.evil.com/signin"), false);
    assert.equal(isValidVerificationUrl(null), false);
    assert.equal(isValidVerificationUrl(undefined), false);
  });
});

test("verificationStore state mapping and connection lookup", async (t) => {
  await t.test("parses single latest and multiple per-connection verifications", () => {
    useVerificationStore.getState().clearAll();

    useVerificationStore.getState().setFromPayload({
      antigravityVerification: {
        url: "https://accounts.google.com/v1",
        connectionId: "conn-1",
        account: "acc1@gmail.com",
      },
      antigravityVerifications: {
        "conn-1": {
          url: "https://accounts.google.com/v1",
          connectionId: "conn-1",
          account: "acc1@gmail.com",
        },
        "conn-2": {
          url: "https://accounts.google.com/v2",
          connectionId: "conn-2",
          account: "acc2@gmail.com",
        },
        "conn-bad": {
          url: "https://evil.com/v3",
          connectionId: "conn-bad",
        }
      }
    });

    const rec1 = useVerificationStore.getState().getForConnection("conn-1");
    assert.equal(rec1?.url, "https://accounts.google.com/v1");
    assert.equal(rec1?.account, "acc1@gmail.com");

    const rec2 = useVerificationStore.getState().getForConnection("conn-2");
    assert.equal(rec2?.url, "https://accounts.google.com/v2");
    assert.equal(rec2?.account, "acc2@gmail.com");

    const recBad = useVerificationStore.getState().getForConnection("conn-bad");
    assert.equal(recBad, null);

    const recUnset = useVerificationStore.getState().getForConnection("conn-unset");
    assert.equal(recUnset, null);
  });
});
