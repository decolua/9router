# 02: Detect Sevalla and hide update banner

**What to build:** When the Router runs on Sevalla, the "New version available / Update now" banner must not appear in the dashboard. The Operator should never be able to trigger the self-update flow on a hosted instance, because `npm i -g` is a no-op there and the shutdown step kills the process permanently. Detection must be automatic (zero-config) using the `BASE_URL` signal already present in the Sevalla environment.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `isContainerDeploy()` returns `true` when `process.env.BASE_URL` ends with `.sevalla.app`
- [ ] `/api/version` returns `hasUpdate: false` and `containerDeploy: true` under that condition
- [ ] The "Update now" banner does not render in the Sidebar when the above holds
- [ ] Existing detection paths (`CONTAINER_DEPLOY=1`, `RENDER`, `FLY_APP_NAME`, `K_SERVICE`, `/.dockerenv`) still work unchanged
- [ ] A unit test covers the Sevalla heuristic plus a negative case (local `BASE_URL` does not trigger it)