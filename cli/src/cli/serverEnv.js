// The spawned app server cannot see CLI flags, so every flag that changes what
// the dashboard does has to be handed over through the environment.
function buildServerEnv({ baseEnv = process.env, port, host, skipUpdate = false } = {}) {
  return {
    ...baseEnv,
    PORT: String(port),
    HOSTNAME: host,
    ...(skipUpdate ? { NINEROUTER_SKIP_UPDATE: "1" } : {}),
  };
}

module.exports = { buildServerEnv };
