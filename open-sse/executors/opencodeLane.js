// OpenCode Free — one provider, two lanes.
//
// The dashboard shows a single "OpenCode Free" card with a hammer toggle. The
// toggle writes `opencodeCliMode`, and this executor is the only reader: with it
// off the request goes out through the direct TLS client (`opencodeV2`), with it
// on through the local CLI lane (`opencode`). Keeping the switch here means the
// registry stays one entry while both lanes keep their own implementation.
//
// The setting is read lazily (dynamic import) so this module never participates
// in a registry ↔ db import cycle, and cached briefly so a burst of requests
// does not hit SQLite once per call.
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeV2Executor } from "./opencodeV2.js";

const LANE_TTL_MS = 3000;

const directLane = new OpenCodeV2Executor();
const cliLane = new OpenCodeExecutor();

let lane = "direct";
let laneReadAt = 0;

async function currentLane() {
  if (Date.now() - laneReadAt < LANE_TTL_MS) return lane;
  try {
    const { getSettings } = await import("@/lib/localDb.js");
    const settings = await getSettings();
    lane = settings?.opencodeCliMode === true ? "cli" : "direct";
  } catch {
    // A settings read must never break a request: fall back to the lane that
    // works on a bare host.
    lane = "direct";
  }
  laneReadAt = Date.now();
  return lane;
}

export class OpenCodeLaneExecutor extends BaseExecutor {
  constructor(provider = "opencode") {
    super(provider, PROVIDERS[provider] || PROVIDERS.opencode || {});
  }

  async execute(args) {
    const active = await currentLane();
    return (active === "cli" ? cliLane : directLane).execute(args);
  }

  async refreshCredentials(...args) {
    const active = await currentLane();
    return (active === "cli" ? cliLane : directLane).refreshCredentials(...args);
  }

  // Sync callers (chatCore's translate/send routes, the dashboard's model test
  // button) call these on the executor `getExecutor()` handed them, so the lane
  // shell has to expose them. They follow the same default as `execute` — the
  // direct lane — because `currentLane()` is async and these are not.
  prepareRequestCredentials(...args) {
    return directLane.prepareRequestCredentials(...args);
  }

  transformRequest(...args) {
    return directLane.transformRequest(...args);
  }

  buildUrl(...args) {
    return directLane.buildUrl(...args);
  }

  buildHeaders(...args) {
    return directLane.buildHeaders(...args);
  }
}
