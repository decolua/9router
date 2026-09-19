# 9Router

Local AI request router: Clients send chat (and related) traffic to one endpoint; the Operator configures how that traffic reaches Providers.

## Language

**Router**:
The 9Router product — the local process that accepts Client requests, translates formats, applies token-saving and fallback, and calls Providers.
_Avoid_: Proxy, gateway, middleware (as the primary name)

**Operator**:
The person who installs, configures, and monitors the Router (dashboard, connections, fallback tiers, limits).
_Avoid_: User, admin, developer (when meaning the person at the dashboard)

**Client**:
An AI coding tool or app that sends OpenAI-compatible (or other supported) requests to the Router.
_Avoid_: User, developer, IDE (as the primary name for the tool itself)

**Provider**:
A named upstream AI backend the Router can call (e.g. Claude, Kiro, GLM).
_Avoid_: Vendor, model-host, service (as the primary name)

**Connection**:
One saved auth binding from the Operator to a Provider (OAuth or API key).
_Avoid_: Credential row, integration (as the primary name)

**Account**:
One of several logins under the same Provider, used when the Router rotates or falls across Connections.
_Avoid_: User, profile (when meaning a Provider login)

**Model**:
The model identity the Client requests (alias or `provider/model`); the Router resolves it to a Provider and upstream model id.
_Avoid_: LLM, engine (as the primary name)

**Fallback**:
Automatically trying another Connection or Provider when the current path is blocked (quota, rate limit, budget), typically along Operator-ordered tiers (e.g. subscription → cheap → free).
_Avoid_: Failover, tiering (as the primary name for the behavior)

**RTK**:
Request-time compression of tool results so Clients burn fewer tokens per turn.
_Avoid_: Token Saver, compressor (as the primary name)

**Format**:
The wire shape of a Client or Provider request/response (e.g. OpenAI, Claude, Gemini) that the Router translates between.
_Avoid_: Protocol, schema, dialect (as the primary name)
