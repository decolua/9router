/**
 * Connection matching service with O(1) lookup performance
 */

export class ConnectionMatcher {
  constructor(connections) {
    this.byId = new Map();
    this.byEmail = new Map();
    this.byName = new Map();
    this.byProvider = new Map();
    this.processedIds = new Set();

    for (const conn of connections) {
      // ID index
      this.byId.set(conn.id, conn);

      // Email index (OAuth only)
      if (conn.authType === "oauth" && conn.email) {
        const key = `${conn.provider}:${conn.email}`;
        this.byEmail.set(key, conn);
      }

      // Name index
      if (conn.name) {
        const key = `${conn.provider}:${conn.authType}:${conn.name}`;
        this.byName.set(key, conn);
      }

      // Provider index
      if (!this.byProvider.has(conn.provider)) {
        this.byProvider.set(conn.provider, []);
      }
      this.byProvider.get(conn.provider).push(conn);
    }
  }

  findMatch(record, sourceId) {
    // Strategy 1: Match by source ID (exact match from backup)
    if (sourceId) {
      const conn = this.byId.get(sourceId);
      if (
        conn &&
        conn.provider === record.provider &&
        conn.authType === record.authType &&
        !this.processedIds.has(conn.id)
      ) {
        return conn;
      }
    }

    // Strategy 2: Match OAuth by email (unique identifier)
    if (record.authType === "oauth" && record.email) {
      const key = `${record.provider}:${record.email}`;
      const conn = this.byEmail.get(key);
      if (conn && !this.processedIds.has(conn.id)) {
        return conn;
      }
    }

    // Strategy 3: Match by name (for API keys or named connections)
    if (record.name) {
      const key = `${record.provider}:${record.authType}:${record.name}`;
      const conn = this.byName.get(key);
      if (conn && !this.processedIds.has(conn.id)) {
        return conn;
      }
    }

    // Strategy 4: Single OAuth fallback
    if (record.authType === "oauth") {
      const providerConns = this.byProvider.get(record.provider) || [];
      const unprocessed = providerConns.filter(
        (c) => c.authType === "oauth" && !this.processedIds.has(c.id),
      );
      if (unprocessed.length === 1) {
        return unprocessed[0];
      }
    }

    return null;
  }

  markProcessed(connectionId) {
    this.processedIds.add(connectionId);
  }

  addConnection(connection) {
    this.byId.set(connection.id, connection);

    if (connection.authType === "oauth" && connection.email) {
      const key = `${connection.provider}:${connection.email}`;
      this.byEmail.set(key, connection);
    }

    if (connection.name) {
      const key = `${connection.provider}:${connection.authType}:${connection.name}`;
      this.byName.set(key, connection);
    }

    if (!this.byProvider.has(connection.provider)) {
      this.byProvider.set(connection.provider, []);
    }
    this.byProvider.get(connection.provider).push(connection);
  }

  updateConnection(connectionId, updates) {
    const conn = this.byId.get(connectionId);
    if (!conn) return;

    const oldProvider = conn.provider;
    const oldEmail = conn.email;
    const oldName = conn.name;

    // Remove old indexes before updating
    if (conn.authType === "oauth" && oldEmail) {
      const oldKey = `${oldProvider}:${oldEmail}`;
      this.byEmail.delete(oldKey);
    }
    if (oldName) {
      const oldKey = `${oldProvider}:${conn.authType}:${oldName}`;
      this.byName.delete(oldKey);
    }

    // Apply updates
    Object.assign(conn, updates);

    // If provider changed, move to new provider array
    if (updates.provider && updates.provider !== oldProvider) {
      const oldArray = this.byProvider.get(oldProvider) || [];
      const index = oldArray.findIndex((c) => c.id === connectionId);
      if (index !== -1) oldArray.splice(index, 1);

      if (!this.byProvider.has(conn.provider)) {
        this.byProvider.set(conn.provider, []);
      }
      this.byProvider.get(conn.provider).push(conn);
    }

    // Rebuild indexes with new values
    if (conn.authType === "oauth" && conn.email) {
      const newKey = `${conn.provider}:${conn.email}`;
      this.byEmail.set(newKey, conn);
    }
    if (conn.name) {
      const newKey = `${conn.provider}:${conn.authType}:${conn.name}`;
      this.byName.set(newKey, conn);
    }
  }
}

export function validateNoDuplicateImports(records) {
  const seen = new Map();
  const duplicates = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    let key;

    if (record.authType === "oauth" && record.email) {
      key = `${record.provider}:oauth:${record.email}`;
    } else if (record.name) {
      key = `${record.provider}:${record.authType}:${record.name}`;
    } else {
      continue; // Skip records without unique identifier
    }

    if (seen.has(key)) {
      duplicates.push({
        index: i,
        firstIndex: seen.get(key),
        key,
      });
    } else {
      seen.set(key, i);
    }
  }

  return duplicates;
}
