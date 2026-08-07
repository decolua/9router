// FED-005 — FederationStatus banner view logic tests (spec §3.5 UX).
//
// The banner component itself is React (no jsdom in tests/), so the
// state→display mapping is extracted into a pure module
// (src/lib/federation/statusView.js) and tested here for every render
// state:
//  - LINKED → success badge, "Federation linked", no lag text
//  - DEGRADED → error badge, "Federation degraded"
//  - RECOVERING → info badge, "Federation recovering"
//  - standalone → null (render nothing, zero drift)
//  - central → null (banner is an edge-only UX)
//  - unknown/error/malformed → null (hide quietly, retry next poll)
//  - lag formatting: 0/absent → no lag text; > 0 → "behind N revisions"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = ["FEDERATION_MODE", "FEDERATION_TOKEN"];

const savedEnv = {};

beforeEach(() => {
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function loadView() {
  return import("@/lib/federation/statusView.js");
}

describe("federationStatusView — edge render states (acceptance 1)", () => {
  it("LINKED → success variant, 'Federation linked' label, no lag text", async () => {
    const { federationStatusView } = await loadView();
    const view = federationStatusView({ role: "edge", last_state: "linked", revisionLag: 0 });
    expect(view).not.toBeNull();
    expect(view.variant).toBe("success");
    expect(view.label).toBe("Federation linked");
    expect(view.lagText).toBe("");
  });

  it("DEGRADED → error variant, 'Federation degraded' label", async () => {
    const { federationStatusView } = await loadView();
    const view = federationStatusView({ role: "edge", last_state: "degraded", revisionLag: 0 });
    expect(view.variant).toBe("error");
    expect(view.label).toBe("Federation degraded");
  });

  it("RECOVERING → info variant, 'Federation recovering' label", async () => {
    const { federationStatusView } = await loadView();
    const view = federationStatusView({ role: "edge", last_state: "recovering", revisionLag: 0 });
    expect(view.variant).toBe("info");
    expect(view.label).toBe("Federation recovering");
  });

  it("revision lag > 0 → 'behind N revisions' text (singular for 1)", async () => {
    const { federationStatusView } = await loadView();
    const view = federationStatusView({ role: "edge", last_state: "linked", revisionLag: 4 });
    expect(view.lagText).toBe("behind 4 revisions");
    const one = federationStatusView({ role: "edge", last_state: "linked", revisionLag: 1 });
    expect(one.lagText).toBe("behind 1 revision");
  });
});

describe("federationStatusView — hide states (acceptance 1/5)", () => {
  it("standalone → null (render nothing, zero drift)", async () => {
    const { federationStatusView } = await loadView();
    expect(federationStatusView({ role: "standalone", revisionLag: 0 })).toBeNull();
  });

  it("central → null (banner is an edge-only UX)", async () => {
    const { federationStatusView } = await loadView();
    expect(federationStatusView({ role: "central", revisionLag: 0 })).toBeNull();
  });

  it("unknown last_state → null (hide quietly, retry next poll)", async () => {
    const { federationStatusView } = await loadView();
    expect(federationStatusView({ role: "edge", last_state: "weird", revisionLag: 0 })).toBeNull();
    expect(federationStatusView({ role: "edge", last_state: undefined, revisionLag: 0 })).toBeNull();
  });

  it("malformed payload → null (defensive)", async () => {
    const { federationStatusView } = await loadView();
    expect(federationStatusView(null)).toBeNull();
    expect(federationStatusView(undefined)).toBeNull();
    expect(federationStatusView("nope")).toBeNull();
    expect(federationStatusView({})).toBeNull();
  });
});

describe("formatRevisionLag (acceptance 1)", () => {
  it("0 / absent / negative → empty string (no lag text)", async () => {
    const { formatRevisionLag } = await loadView();
    expect(formatRevisionLag(0)).toBe("");
    expect(formatRevisionLag(undefined)).toBe("");
    expect(formatRevisionLag(null)).toBe("");
    expect(formatRevisionLag(-3)).toBe("");
    expect(formatRevisionLag("0")).toBe("");
  });

  it("> 0 → 'behind N revisions' with correct pluralization", async () => {
    const { formatRevisionLag } = await loadView();
    expect(formatRevisionLag(1)).toBe("behind 1 revision");
    expect(formatRevisionLag(2)).toBe("behind 2 revisions");
    expect(formatRevisionLag(100)).toBe("behind 100 revisions");
  });
});
