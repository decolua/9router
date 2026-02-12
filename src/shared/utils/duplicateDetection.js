/**
 * Duplicate Detection Utilities
 * 
 * Handles detection of duplicate provider connections based on:
 * - OAuth: email, userId, or provider-specific identifiers
 * - API Key: hashed key comparison
 */

import crypto from "crypto";

/**
 * Hash an API key for secure comparison
 * @param {string} apiKey - The API key to hash
 * @returns {string} SHA-256 hash of the API key
 */
export function hashApiKey(apiKey) {
  if (!apiKey) return null;
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Check if two OAuth connections are duplicates
 * @param {object} connection1 - First connection
 * @param {object} connection2 - Second connection
 * @returns {boolean} True if connections are duplicates
 */
export function isOAuthDuplicate(connection1, connection2) {
  // Must be same provider
  if (connection1.provider !== connection2.provider) {
    return false;
  }

  // Check by email (most common OAuth identifier)
  if (connection1.email && connection2.email) {
    return connection1.email.toLowerCase() === connection2.email.toLowerCase();
  }

  // Provider-specific checks
  switch (connection1.provider) {
    case "github":
      // Check GitHub user ID or login
      if (
        connection1.providerSpecificData?.githubUserId &&
        connection2.providerSpecificData?.githubUserId
      ) {
        return (
          connection1.providerSpecificData.githubUserId ===
          connection2.providerSpecificData.githubUserId
        );
      }
      if (
        connection1.providerSpecificData?.githubLogin &&
        connection2.providerSpecificData?.githubLogin
      ) {
        return (
          connection1.providerSpecificData.githubLogin.toLowerCase() ===
          connection2.providerSpecificData.githubLogin.toLowerCase()
        );
      }
      break;

    case "antigravity":
    case "gemini-cli":
      // Check by project ID for Google-based providers
      if (connection1.projectId && connection2.projectId) {
        return connection1.projectId === connection2.projectId;
      }
      break;

    case "codex":
      // Codex uses email from idToken
      if (connection1.email && connection2.email) {
        return connection1.email.toLowerCase() === connection2.email.toLowerCase();
      }
      break;

    case "cursor":
      // Cursor uses machine ID
      if (
        connection1.providerSpecificData?.machineId &&
        connection2.providerSpecificData?.machineId
      ) {
        return (
          connection1.providerSpecificData.machineId ===
          connection2.providerSpecificData.machineId
        );
      }
      break;
  }

  return false;
}

/**
 * Check if two API key connections are duplicates
 * @param {object} connection1 - First connection
 * @param {object} connection2 - Second connection
 * @returns {boolean} True if connections are duplicates
 */
export function isApiKeyDuplicate(connection1, connection2) {
  // Must be same provider
  if (connection1.provider !== connection2.provider) {
    return false;
  }

  // Compare hashed API keys
  if (connection1.apiKey && connection2.apiKey) {
    const hash1 = hashApiKey(connection1.apiKey);
    const hash2 = hashApiKey(connection2.apiKey);
    return hash1 === hash2;
  }

  return false;
}

/**
 * Find duplicate connection in a list
 * @param {object} newConnection - New connection to check
 * @param {array} existingConnections - List of existing connections
 * @returns {object|null} Duplicate connection if found, null otherwise
 */
export function findDuplicate(newConnection, existingConnections) {
  if (!existingConnections || existingConnections.length === 0) {
    return null;
  }

  for (const existing of existingConnections) {
    // Skip if same ID (updating existing connection)
    if (existing.id === newConnection.id) {
      continue;
    }

    // Check based on auth type
    if (newConnection.authType === "oauth" && existing.authType === "oauth") {
      if (isOAuthDuplicate(newConnection, existing)) {
        return existing;
      }
    } else if (newConnection.authType === "apikey" && existing.authType === "apikey") {
      if (isApiKeyDuplicate(newConnection, existing)) {
        return existing;
      }
    }
  }

  return null;
}

/**
 * Get duplicate detection fingerprint for a connection
 * Used for quick duplicate checking
 * @param {object} connection - Connection to fingerprint
 * @returns {string|null} Fingerprint string or null
 */
export function getConnectionFingerprint(connection) {
  if (connection.authType === "oauth") {
    // Use email or provider-specific identifier
    if (connection.email) {
      return `oauth:${connection.provider}:${connection.email.toLowerCase()}`;
    }
    if (connection.provider === "github" && connection.providerSpecificData?.githubUserId) {
      return `oauth:github:user:${connection.providerSpecificData.githubUserId}`;
    }
    if (
      (connection.provider === "antigravity" || connection.provider === "gemini-cli") &&
      connection.projectId
    ) {
      return `oauth:${connection.provider}:project:${connection.projectId}`;
    }
  } else if (connection.authType === "apikey" && connection.apiKey) {
    // Use hashed API key
    const hash = hashApiKey(connection.apiKey);
    return `apikey:${connection.provider}:${hash.substring(0, 16)}`;
  }

  return null;
}

/**
 * Check if connection is a duplicate and get duplicate info
 * @param {object} newConnection - New connection to check
 * @param {array} existingConnections - List of existing connections
 * @returns {object} { isDuplicate: boolean, duplicate: object|null, reason: string }
 */
export function checkDuplicate(newConnection, existingConnections) {
  const duplicate = findDuplicate(newConnection, existingConnections);

  if (!duplicate) {
    return { isDuplicate: false, duplicate: null, reason: null };
  }

  // Determine reason
  let reason = "Unknown duplicate";
  if (newConnection.authType === "oauth") {
    if (newConnection.email && duplicate.email) {
      reason = `Same email: ${duplicate.email}`;
    } else if (newConnection.provider === "github") {
      reason = `Same GitHub account`;
    } else if (newConnection.provider === "antigravity" || newConnection.provider === "gemini-cli") {
      reason = `Same Google project`;
    } else {
      reason = `Same OAuth account`;
    }
  } else if (newConnection.authType === "apikey") {
    reason = `Same API key`;
  }

  return {
    isDuplicate: true,
    duplicate,
    reason,
  };
}