// Codex-native ingress: POST /backend-api/codex/responses/compact
// Same handler as /v1/responses/compact — see ../route.js for why the mirror exists.
export { OPTIONS, POST } from "../../../responses/compact/route.js";
