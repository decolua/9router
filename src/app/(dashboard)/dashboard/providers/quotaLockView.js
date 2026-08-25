export function sanitizeReason(text) {
    if (typeof text !== 'string' || !text.trim()) return null;

    let sanitized = text
        // Redact URLs
        .replace(/https?:\/\/[^\s]+/gi, '[URL redacted]')
        // Redact bearers/tokens
        .replace(/(bearer|token)[\s:=]+[A-Za-z0-9\-_./+=~]+/gi, '[TOKEN redacted]')
        // Redact sensitive headers - capture rest of string to end or boundary
        .replace(/(cookie|authorization)[\s:=]+.*?(?=,|$|\]|\})/gi, '[AUTH redacted]')
        // Replace all ASCII control characters
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        // Remove double spaces
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Truncate to 160 chars
    if (sanitized.length > 160) {
        sanitized = sanitized.substring(0, 157) + '...';
    }

    return sanitized || null;
}

export function mergeQuotaLockFields(connections) {
    if (!Array.isArray(connections)) return {};

    return connections.reduce((merged, conn) => {
        if (!conn || typeof conn !== 'object') return merged;

        if (conn.quotaResetAt) {
            const currentExpiry = merged.quotaResetAt;
            const newExpiry = typeof conn.quotaResetAt === 'string' ? Date.parse(conn.quotaResetAt) : conn.quotaResetAt;
            if (typeof newExpiry === 'number' && Number.isFinite(newExpiry) && (!currentExpiry || newExpiry > currentExpiry)) {
                merged.quotaResetAt = newExpiry;
                if (conn.quotaResetAtReason) merged.quotaResetAtReason = conn.quotaResetAtReason;
                if (conn.quotaResetAtSource) merged.quotaResetAtSource = conn.quotaResetAtSource;
                if (conn.quotaResetAtClassifiedAt) merged.quotaResetAtClassifiedAt = conn.quotaResetAtClassifiedAt;
            }
        }

        for (const [key, value] of Object.entries(conn)) {
            if (key.startsWith('modelLock_') && !key.endsWith('Reason') && !key.endsWith('Source') && !key.endsWith('ClassifiedAt')) {
                const currentExpiry = merged[key];
                const newExpiry = typeof value === 'string' ? Date.parse(value) : value;
                if (typeof newExpiry === 'number' && Number.isFinite(newExpiry) && (!currentExpiry || newExpiry > currentExpiry)) {
                    merged[key] = newExpiry;
                    if (conn[`${key}Reason`]) merged[`${key}Reason`] = conn[`${key}Reason`];
                    if (conn[`${key}Source`]) merged[`${key}Source`] = conn[`${key}Source`];
                    if (conn[`${key}ClassifiedAt`]) merged[`${key}ClassifiedAt`] = conn[`${key}ClassifiedAt`];
                }
            }
        }
        return merged;
    }, {});
}

export function getEffectiveConnectionStatus(connection, nowArg = null, exactModelId = null) {
    if (!connection || typeof connection !== 'object') return 'Unknown';
    const lockInfo = deriveQuotaLockView(connection, nowArg, exactModelId);

    if (connection.testStatus === "unavailable" && !lockInfo.isActive) {
        return "active";
    }

    return connection.testStatus || "Unknown";
}

export function deriveQuotaLockView(provider, nowArg = null, exactModelId = null) {
    const now = nowArg ?? Date.now();
    const emptyState = { isActive: false, scope: null, expiry: null, reason: null, source: null, classifiedAt: null, additionalModelLocks: 0, nearestModelId: null };

    if (!provider || typeof provider !== 'object') {
        return emptyState;
    }

    const getLockDetails = (modelKey) => {
        const expiryRaw = provider[modelKey];
        const expiryTime = typeof expiryRaw === 'string' ? Date.parse(expiryRaw) : expiryRaw;

        if (typeof expiryTime !== 'number' || !Number.isFinite(expiryTime) || expiryTime <= now) return null;

        const reasonRaw = provider[`${modelKey}Reason`];
        const sourceRaw = provider[`${modelKey}Source`];
        const classifiedAtRaw = provider[`${modelKey}ClassifiedAt`];
        let classifiedAtTime = null;
        if (classifiedAtRaw) {
            const parsed = typeof classifiedAtRaw === 'string' ? Date.parse(classifiedAtRaw) : classifiedAtRaw;
            if (typeof parsed === 'number' && Number.isFinite(parsed)) {
                classifiedAtTime = parsed;
            }
        }

        return {
            expiry: expiryTime,
            reason: sanitizeReason(reasonRaw) || 'Quota limit',
            source: sanitizeReason(sourceRaw) || 'legacy',
            classifiedAt: classifiedAtTime
        };
    };

    const globalLockDetails = getLockDetails('modelLock___all') || getLockDetails('quotaResetAt');

    if (globalLockDetails) {
        return {
            isActive: true,
            scope: 'account',
            expiry: globalLockDetails.expiry,
            reason: globalLockDetails.reason,
            source: globalLockDetails.source,
            classifiedAt: globalLockDetails.classifiedAt,
            additionalModelLocks: 0,
            nearestModelId: null
        };
    }

    if (exactModelId) {
        const exactKey = `modelLock_${exactModelId}`;
        const exactLock = getLockDetails(exactKey);
        if (exactLock) {
            return {
                isActive: true,
                scope: 'model',
                expiry: exactLock.expiry,
                reason: exactLock.reason,
                source: exactLock.source,
                classifiedAt: exactLock.classifiedAt,
                additionalModelLocks: 0,
                nearestModelId: exactModelId
            };
        }
        return emptyState;
    }

    let nearestExpiry = Infinity;
    let nearestLock = null;
    let nearestModelId = null;
    let activeModelCount = 0;

    for (const key of Object.keys(provider)) {
        if (key.startsWith('modelLock_') &&
            !key.endsWith('Reason') &&
            !key.endsWith('Source') &&
            !key.endsWith('ClassifiedAt') &&
            key !== 'modelLock___all') {

            const modelId = key.substring('modelLock_'.length);
            const lockDetails = getLockDetails(key);

            if (lockDetails) {
                activeModelCount++;
                if (lockDetails.expiry < nearestExpiry) {
                    nearestExpiry = lockDetails.expiry;
                    nearestLock = lockDetails;
                    nearestModelId = modelId;
                }
            }
        }
    }

    if (nearestLock) {
        return {
            isActive: true,
            scope: 'model',
            expiry: nearestLock.expiry,
            reason: nearestLock.reason,
            source: nearestLock.source,
            classifiedAt: nearestLock.classifiedAt,
            additionalModelLocks: activeModelCount - 1,
            nearestModelId
        };
    }

    return emptyState;
}


