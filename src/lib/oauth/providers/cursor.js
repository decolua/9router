import { CURSOR_CONFIG } from "../constants/oauth.js";

const cursor = {
  config: CURSOR_CONFIG,
  flowType: "import_token",
  // Cursor uses import token flow - tokens are extracted from local SQLite database
  // No OAuth flow needed, handled by /api/oauth/cursor/import route
  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: null, // Cursor doesn't have public refresh endpoint
    expiresIn: tokens.expiresIn || 86400,
    providerSpecificData: {
      machineId: tokens.machineId,
      authMethod: "imported",
    },
  }),
};

export default cursor;
