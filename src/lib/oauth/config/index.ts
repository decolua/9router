/**
 * OAuth Server Configuration
 */

export function getServerCredentials() {
  return {
    server: process.env.BASE_URL || "http://localhost:20128",
    token: process.env.AUTH_TOKEN || "sk_8router",
    userId: "admin",
  };
}
