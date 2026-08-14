export function resolveCodexAccountId(credentials) {
  return credentials?.providerSpecificData?.workspaceId
    || credentials?.providerSpecificData?.chatgptAccountId
    || credentials?.providerSpecificData?.accountId
    || null;
}
