import { describe, expect, it } from "vitest";
import { CodeBuddyBulkImportManager } from "../../src/lib/oauth/services/codebuddyBulkImportManager.js";

function createFakeBrowser() {
  const fakePage = {
    on() {},
    off() {},
    url() {
      return "about:blank";
    },
    bringToFront: async () => null,
    context() {
      return {};
    },
  };

  return {
    async newContext() {
      return {
        async newPage() {
          return fakePage;
        },
        on() {},
        off() {},
        async close() {
          return null;
        },
      };
    },
    async close() {
      return null;
    },
  };
}

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("CodeBuddyBulkImportManager", () => {
  it("runs bulk GSuite accounts through CodeBuddy polling and saves connections", async () => {
    const saved = [];
    const manager = new CodeBuddyBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      requestDeviceCodeFn: async () => ({
        device_code: "state-1",
        verification_uri: "https://copilot.tencent.com/login",
      }),
      pollToken: async () => ({
        success: true,
        tokens: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresIn: 86400,
        },
      }),
      saveConnection: async ({ tokens, email }) => {
        saved.push({ tokens, email });
        return {
          connection: { id: `conn-${email}` },
        };
      },
      createApiKeyFn: async (_page, email) => ({
        key: `cb-key-${email}`,
        id: `key-id-${email}`,
        name: `9router-${email}`,
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
      findExistingApiKeyFn: async () => null,
      fetchLoginAccountFn: async (_accessToken, state) => ({
        uid: `uid-${state}`,
        enterpriseId: "enterprise-1",
      }),
      googleAutomation: async ({ successPromise }) => ({
        status: "success",
        ...(await successPromise),
      }),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@example.com|pw1",
        "user2@example.com|pw2",
      ],
      concurrency: 2,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(finishedJob.summary.success).toBe(2);
    expect(saved.map((entry) => entry.email).sort()).toEqual([
      "user1@example.com",
      "user2@example.com",
    ]);
    expect(saved.every((entry) => entry.tokens.generatedApiKey?.key?.startsWith("cb-key-"))).toBe(true);
    expect(saved.every((entry) => entry.tokens.providerSpecificData?.uid?.startsWith("uid-state-1"))).toBe(true);
    expect(saved.every((entry) => entry.tokens.providerSpecificData?.enterpriseId === "enterprise-1")).toBe(true);
    expect(finishedJob.accounts.every((account) => account.connectionId)).toBe(true);
  });

  it("retries transient CodeBuddy token request failures before saving", async () => {
    let attempts = 0;
    const manager = new CodeBuddyBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      requestDeviceCodeFn: async () => ({
        device_code: "state-1",
        verification_uri: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      }),
      pollToken: async () => {
        attempts += 1;
        if (attempts < 3) {
          return {
            success: false,
            error: "request_failed",
            errorDescription: "temporary 502",
          };
        }
        return {
          success: true,
          tokens: {
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresIn: 86400,
          },
        };
      },
      saveConnection: async ({ email }) => ({
        connection: { id: `conn-${email}` },
      }),
      createApiKeyFn: async (_page, email) => ({
        key: `cb-key-${email}`,
        id: `key-id-${email}`,
        name: `9router-${email}`,
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
      findExistingApiKeyFn: async () => null,
      fetchLoginAccountFn: async () => null,
      pollIntervalMs: 10,
      googleAutomation: async ({ successPromise }) => ({
        status: "success",
        ...(await successPromise),
      }),
    });

    const startedJob = await manager.startJob({
      accounts: ["user1@example.com|pw1"],
      concurrency: 1,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(attempts).toBe(3);
    expect(finishedJob.summary.success).toBe(1);
  });

  it("does not mark CodeBuddy OAuth success as final success when API key creation fails", async () => {
    const saved = [];
    const manager = new CodeBuddyBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      requestDeviceCodeFn: async () => ({
        device_code: "state-1",
        verification_uri: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      }),
      pollToken: async () => ({
        success: true,
        tokens: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresIn: 86400,
        },
      }),
      saveConnection: async ({ tokens, email }) => {
        saved.push({ tokens, email });
        return { connection: { id: `conn-${email}` } };
      },
      createApiKeyFn: async () => {
        const error = new Error("CodeBuddy API key limit reached");
        error.step = "key_limit_reached";
        error.status = "failed";
        throw error;
      },
      findExistingApiKeyFn: async () => null,
      fetchLoginAccountFn: async () => null,
      googleAutomation: async ({ successPromise }) => ({
        status: "success",
        ...(await successPromise),
      }),
    });

    const startedJob = await manager.startJob({
      accounts: ["user1@example.com|pw1"],
      concurrency: 1,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "failed" ? job : null;
    });

    expect(saved).toEqual([]);
    expect(finishedJob.summary.success).toBe(0);
    expect(finishedJob.summary.failed).toBe(1);
    expect(finishedJob.accounts[0].currentStep).toBe("key_limit_reached");
  });

  it("replays CodeBuddy key creation instead of skipping restricted accounts", async () => {
    const saved = [];
    let createKeyCalls = 0;
    let createKeyOptions = null;
    const manager = new CodeBuddyBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      requestDeviceCodeFn: async () => ({
        device_code: "state-1",
        verification_uri: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      }),
      pollToken: async () => ({
        success: false,
        pending: true,
        error: "authorization_pending",
      }),
      saveConnection: async ({ tokens, email }) => {
        saved.push({ tokens, email });
        return { connection: { id: `conn-${email}` } };
      },
      createApiKeyFn: async (_page, email, _onStep, options) => {
        createKeyCalls += 1;
        createKeyOptions = options;
        return {
          key: `cb-key-${email}`,
          id: `key-id-${email}`,
          name: `9router-${email}`,
          expiresAt: "2027-01-01T00:00:00.000Z",
        };
      },
      findExistingApiKeyFn: async () => null,
      fetchLoginAccountFn: async () => null,
      googleAutomation: async () => ({
        status: "failed_restricted",
        error: "Account is restricted, suspended, or banned. Skipping.",
      }),
    });

    const startedJob = await manager.startJob({
      accounts: ["user1@example.com|pw1"],
      concurrency: 1,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(createKeyCalls).toBe(1);
    expect(createKeyOptions.directReplay).toBe(true);
    expect(createKeyOptions.userEnterpriseId).toBe("personal-edition-user-id");
    expect(saved).toHaveLength(1);
    expect(saved[0].tokens.generatedApiKey.key).toBe("cb-key-user1@example.com");
    expect(saved[0].tokens.providerSpecificData.restrictedDetected).toBe(true);
    expect(finishedJob.summary.success).toBe(1);
    expect(finishedJob.accounts[0].currentStep).toBe("connection_saved");
  });

  it("skips creating a new CodeBuddy API key when the account already has one", async () => {
    const saved = [];
    let createKeyCalls = 0;
    const manager = new CodeBuddyBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      requestDeviceCodeFn: async () => ({
        device_code: "state-1",
        verification_uri: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      }),
      pollToken: async () => ({
        success: true,
        tokens: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresIn: 86400,
        },
      }),
      saveConnection: async ({ tokens, email }) => {
        saved.push({ tokens, email });
        return { connection: { id: `conn-${email}` } };
      },
      createApiKeyFn: async () => {
        createKeyCalls += 1;
        throw new Error("should not create a duplicate key");
      },
      findExistingApiKeyFn: async () => "existing-cb-key",
      fetchLoginAccountFn: async () => null,
      googleAutomation: async ({ successPromise }) => ({
        status: "success",
        ...(await successPromise),
      }),
    });

    const startedJob = await manager.startJob({
      accounts: ["user1@example.com|pw1"],
      concurrency: 1,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(createKeyCalls).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0].tokens.generatedApiKey).toBeUndefined();
    expect(finishedJob.summary.success).toBe(1);
  });

  it("keeps the proxy auth failure step when CodeBuddy cannot open through proxy", async () => {
    const manager = new CodeBuddyBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      requestDeviceCodeFn: async () => ({
        device_code: "state-1",
        verification_uri: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      }),
      pollToken: async () => ({
        success: false,
        pending: true,
        error: "authorization_pending",
      }),
      googleAutomation: async () => ({
        status: "failed_proxy",
        step: "proxy_auth_failed",
        error: "Proxy authentication failed while opening CodeBuddy OAuth.",
      }),
    });

    const startedJob = await manager.startJob({
      accounts: ["user1@example.com|pw1"],
      concurrency: 1,
      proxyUrl: "http://proxy:8080",
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "failed" ? job : null;
    });

    expect(finishedJob.summary.failed).toBe(1);
    expect(finishedJob.accounts[0].currentStep).toBe("proxy_auth_failed");
    expect(finishedJob.accounts[0].error).toBe("Proxy authentication failed while opening CodeBuddy OAuth.");
  });
});
