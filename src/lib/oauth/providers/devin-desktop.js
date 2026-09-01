const devinDesktop = {
  config: {},
  flowType: "import_token",

  // Import-token adapter. The UI/API closure phase may present a dedicated
  // paste-token surface; this handler is already resolvable by OAuth core.
  exchangeToken: async (_config, code) => {
    const accessToken = String(code || "").trim();
    if (accessToken.length < 16) {
      throw new Error("Invalid Devin Desktop token");
    }
    return { accessToken };
  },

  mapTokens: (tokens) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: null,
    providerSpecificData: {
      authMethod: "import_token",
    },
  }),
};

export default devinDesktop;
