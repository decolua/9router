// Re-export from open-sse with worker logger
import * as log from "../utils/logger.js";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshTokenByProvider as _refreshTokenByProvider
} from "open-sse/services/tokenRefresh.js";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;

export const refreshTokenByProvider = (provider, credentials) => 
  _refreshTokenByProvider(provider, credentials, log);
