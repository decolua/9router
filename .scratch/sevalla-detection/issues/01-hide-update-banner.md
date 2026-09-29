# Spec: Hide Update Banner on Sevalla

## Problem Statement
The Operator sees a "New version available" banner with an "Update now" button on the Sevalla hosted deployment. Clicking this button attempts a global npm install (which fails or corrupts the ephemeral filesystem) and then shuts down the server, causing downtime without a successful update. The Router incorrectly identifies the Sevalla environment as a local machine because it lacks the specific environment variables or files currently checked by `isContainerDeploy()`.

## Solution
The Router must detect when it is running on Sevalla and suppress the self-update UI. The `isContainerDeploy()` function in `src/lib/deployMode.js` should be updated to recognize Sevalla-specific environment signals. Since Sevalla does not set `RENDER`, `FLY_APP_NAME`, or `K_SERVICE`, and may not have `/.dockerenv`, we need to identify a reliable signal present in the Sevalla runtime environment (e.g., a specific env var or the presence of `BASE_URL` matching a Sevalla domain pattern, though env vars are preferred).

*Note: The provided env dump shows `BASE_URL=https://router-uz2an.sevalla.app`. While parsing URLs is fragile, checking for a `SEVALLA` specific env var is ideal. If none exists, we may need to rely on a heuristic or ask the user to set `CONTAINER_DEPLOY=1` manually, but the goal of this spec is to make it automatic if possible.*

*Refined Solution based on typical PaaS behavior:* If no specific `SEVALLA_*` env var exists, we can check for the absence of local indicators combined with the presence of hosting indicators, or simply document that `CONTAINER_DEPLOY=1` must be set. However, looking at the env dump, there isn't a clear "I am Sevalla" flag other than the URL.
*Wait, looking closer at the env dump:* There is no `SEVALLA_APP_ID` or similar.
*Decision:* The most robust fix without a specific env var is to check if `process.env.BASE_URL` includes `.sevalla.app` OR simply instruct the user to add `CONTAINER_DEPLOY=1` to their Sevalla env vars.
*Better Decision for Code:* We can add a check for `process.env.BASE_URL?.includes('.sevalla.app')` as a temporary heuristic, OR (preferred) we update the docs/spec to require `CONTAINER_DEPLOY=1` for unknown PaaS.
*Actually, let's look for standard container signals:* Sevalla uses Docker under the hood usually. If `/.dockerenv` isn't there, maybe `/proc/1/cgroup` contains docker/kubepods?
*Simplest Path:* The user provided the env vars. None scream "Sevalla" except the URL.
*Spec Decision:* We will implement a check for `process.env.VERCEL` (just in case), `process.env.RAILWAY_ENVIRONMENT`, etc., but for Sevalla specifically, if no unique env var exists, we will rely on the user setting `CONTAINER_DEPLOY=1` OR we add a heuristic for `.sevalla.app` in `BASE_URL`.
*Let's try to find a Sevalla env var online?* No, I must synthesize from what I know.
*Safe Bet:* The spec will propose adding `CONTAINER_DEPLOY=1` to the Sevalla configuration as the primary fix, and optionally adding a code heuristic if a stable env var is found later.
*Wait, the prompt asks me to synthesize a spec for the AGENT to implement.* The agent can't change the Sevalla dashboard. The agent must change the code.
*Code Change:* The code must detect Sevalla. If `BASE_URL` ends with `.sevalla.app`, treat as container. This is a reasonable heuristic for this specific app.

## User Stories
1. As an Operator hosting on Sevalla, I want the "Update now" banner to be hidden, so that I don't accidentally crash my instance by clicking it.
2. As an Operator, I want the Router to automatically detect Sevalla without me having to manually set extra environment variables, so that deployment is zero-config.
3. As a Developer, I want the container detection logic to be centralized in `deployMode.js`, so that future PaaS providers can be added easily.

## Implementation Decisions
1.  **Module:** `src/lib/deployMode.js`.
2.  **Function:** `isContainerDeploy()`.
3.  **Logic:** Add a check for Sevalla. Since no specific `SEVALLA_*` env var was found in the dump, use `process.env.BASE_URL` ending with `.sevalla.app` as a heuristic signal.
    *   *Alternative:* If `process.env.PORT === '10000'` (common in some PaaS) + no local indicators? Too broad.
    *   *Selected Heuristic:* `process.env.BASE_URL?.endsWith('.sevalla.app')`.
4.  **Fallback:** The existing `CONTAINER_DEPLOY=1` check remains as the manual override for any other unknown PaaS.
5.  **UI:** No changes to `Sidebar.js` needed; it already respects `hasUpdate` from the API, which respects `isContainerDeploy()`.

## Testing Decisions
1.  **Unit Test:** `src/lib/deployMode.test.js` (create if missing).
2.  **Cases:**
    *   Mock `process.env.BASE_URL = 'https://my-app.sevalla.app'` -> `isContainerDeploy()` returns `true`.
    *   Mock `process.env.BASE_URL = 'http://localhost:3000'` -> `isContainerDeploy()` returns `false` (unless other flags set).
    *   Mock `process.env.CONTAINER_DEPLOY = '1'` -> returns `true`.
3.  **Integration:** Verify `/api/version` returns `hasUpdate: false` when `BASE_URL` indicates Sevalla.

## Out of Scope
1.  Implementing a real auto-update mechanism for Sevalla (e.g. triggering a redeploy via API).
2.  Detecting every possible PaaS provider exhaustively (only Sevalla is the immediate pain point).

## Further Notes
*   The env dump provided by the user confirms `BASE_URL` is set.
*   If Sevalla introduces a specific env var later, we should switch to that instead of the URL heuristic.