// The adapter singleton can be shared by separate Next.js module bundles.
export const FATAL_DB_STARTUP = "ERR_GATEWAY_DB_STARTUP";

export class FatalStartupError extends Error {
  code = FATAL_DB_STARTUP;
}
