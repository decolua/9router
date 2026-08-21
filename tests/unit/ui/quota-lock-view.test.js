import { test, expect, describe, vi, afterEach } from 'vitest';
import { deriveQuotaLockView, sanitizeReason } from '../../../src/app/(dashboard)/dashboard/providers/quotaLockView.js';

describe('quotaLockView', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    test('handles empty state', () => {
        expect(deriveQuotaLockView({})).toEqual({
            isActive: false,
            scope: null,
            expiry: null,
            reason: null,
            source: null,
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: null
        });
    });

    test('extracts legacy lock with fake timers', () => {
        vi.useFakeTimers();
        const now = 1000000000;
        vi.setSystemTime(now);

        const expiry = now + 10000;

        expect(deriveQuotaLockView({
            quotaResetAt: expiry
        })).toEqual({
            isActive: true,
            scope: 'account',
            expiry,
            reason: 'Quota limit',
            source: 'legacy',
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: null
        });
    });

    test('extracts legacy lock with explicit nowArg', () => {
        const now = 1000000000;
        const expiry = now + 10000;

        expect(deriveQuotaLockView({
            quotaResetAt: expiry
        }, now)).toEqual({
            isActive: true,
            scope: 'account',
            expiry,
            reason: 'Quota limit',
            source: 'legacy',
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: null
        });
    });

    test('extracts ISO strings and defaults to exact Quota limit / legacy', () => {
        const now = Date.now();
        const globalExpiry = new Date(now + 10000).toISOString();
        const modelExpiry = new Date(now + 5000).toISOString();

        expect(deriveQuotaLockView({
            modelLock___all: globalExpiry,
            'modelLock_model-a': modelExpiry
        }, now)).toEqual({
            isActive: true,
            scope: 'account',
            expiry: Date.parse(globalExpiry),
            reason: 'Quota limit',
            source: 'legacy',
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: null
        });

        expect(deriveQuotaLockView({
            'modelLock_model-a': modelExpiry
        }, now)).toEqual({
            isActive: true,
            scope: 'model',
            expiry: Date.parse(modelExpiry),
            reason: 'Quota limit',
            source: 'legacy',
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: 'model-a'
        });
    });

    test('global lock wins over model lock and shows own metadata', () => {
        const now = Date.now();
        const globalExpiry = now + 10000;
        const modelExpiry = now + 5000;
        const classified = now - 5000;

        expect(deriveQuotaLockView({
            modelLock___all: globalExpiry,
            modelLock___allReason: 'Global reason',
            modelLock___allSource: 'global_source',
            modelLock___allClassifiedAt: classified,
            'modelLock_model-a': modelExpiry,
            'modelLock_model-aReason': 'Model reason',
            'modelLock_model-aSource': 'model_source'
        }, now)).toEqual({
            isActive: true,
            scope: 'account',
            expiry: globalExpiry,
            reason: 'Global reason',
            source: 'global_source',
            classifiedAt: classified,
            additionalModelLocks: 0,
            nearestModelId: null
        });
    });

    test('nearest model lock selected with additional count', () => {
        const now = Date.now();

        expect(deriveQuotaLockView({
            'modelLock_model-a': now + 5000,
            'modelLock_model-aReason': 'Reason A',
            'modelLock_model-aSource': 'Source A',
            'modelLock_model-aClassifiedAt': now - 100,

            'modelLock_model-b': now + 10000,
            'modelLock_model-bReason': 'Reason B',
            'modelLock_model-bSource': 'Source B',
            'modelLock_model-bClassifiedAt': now - 200,

            'modelLock_model-c': now - 1000,
            'modelLock_model-cReason': 'Expired',
            'modelLock_model-cSource': 'Expired'
        }, now)).toEqual({
            isActive: true,
            scope: 'model',
            expiry: now + 5000,
            reason: 'Reason A',
            source: 'Source A',
            classifiedAt: now - 100,
            additionalModelLocks: 1,
            nearestModelId: 'model-a'
        });
    });

    test('ignores malformed, non-finite and expired model locks', () => {
        const now = Date.now();

        expect(deriveQuotaLockView({
            modelLock___all: now - 1000,
            'modelLock_model-a': now - 1000,
            'modelLock_model-aReason': 'Expired A',
            'modelLock_model-b': 'not a number',
            'modelLock_model-bReason': 'Malformed B',
            'modelLock_model-cReason': 'No until',
            'modelLock_model-d': Infinity,
            'modelLock_model-e': NaN,
            'modelLock_model-f': 'not-an-iso-string'
        }, now)).toEqual({
            isActive: false,
            scope: null,
            expiry: null,
            reason: null,
            source: null,
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: null
        });
    });

    test('metadata only valid strings, fallback safely without overriding expiry', () => {
        const now = Date.now();
        const expiry = now + 5000;

        expect(deriveQuotaLockView({
            'modelLock_model-a': expiry,
            'modelLock_model-aReason': { invalid: 'object' },
            'modelLock_model-aSource': null,
            'modelLock_model-aClassifiedAt': 'not a number'
        }, now)).toEqual({
            isActive: true,
            scope: 'model',
            expiry,
            reason: 'Quota limit',
            source: 'legacy',
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: 'model-a'
        });
    });

    test('extracts exact model lock when model ID provided', () => {
        const now = Date.now();
        const provider = {
            'modelLock_model-a': now + 5000,
            'modelLock_model-aReason': 'Reason A',
            'modelLock_model-aSource': 'Source A',
            'modelLock_model-b': now + 10000,
            'modelLock_model-bReason': 'Reason B',
            'modelLock_model-bSource': 'Source B'
        };

        expect(deriveQuotaLockView(provider, now, 'model-b')).toEqual({
            isActive: true,
            scope: 'model',
            expiry: now + 10000,
            reason: 'Reason B',
            source: 'Source B',
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: 'model-b'
        });

        expect(deriveQuotaLockView(provider, now, 'model-c')).toEqual({
            isActive: false,
            scope: null,
            expiry: null,
            reason: null,
            source: null,
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: null
        });

        provider.modelLock___all = now + 15000;
        provider.modelLock___allReason = 'Global';

        expect(deriveQuotaLockView(provider, now, 'model-b')).toEqual({
            isActive: true,
            scope: 'account',
            expiry: now + 15000,
            reason: 'Global',
            source: 'legacy',
            classifiedAt: null,
            additionalModelLocks: 0,
            nearestModelId: null
        });
    });
});

describe('sanitizeReason', () => {
    test('removes URLs', () => {
        expect(sanitizeReason('Limit reached see https://example.com/billing')).toBe('Limit reached see [URL redacted]');
        expect(sanitizeReason('Limit reached see http://example.com')).toBe('Limit reached see [URL redacted]');
    });

    test('removes bearers and tokens', () => {
        expect(sanitizeReason('Auth failed bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz')).toBe('Auth failed [TOKEN redacted]');
        expect(sanitizeReason('Failed with token sk-ant-api03-abcdef123')).toBe('Failed with [TOKEN redacted]');
        expect(sanitizeReason('Failed with token sk-ant-api03-abcdef123+value/with.dots=and_underscores~')).toBe('Failed with [TOKEN redacted]');
    });

    test('assert literal supplied secret absent in BOTH reason and source', () => {
        const now = Date.now();
        const provider = {
            'modelLock_model-a': now + 5000,
            'modelLock_model-aReason': 'Bearer sk-12345',
            'modelLock_model-aSource': 'token: sk-54321',
        };

        const result = deriveQuotaLockView(provider, now, 'model-a');
        expect(result.reason).not.toContain('sk-12345');
        expect(result.source).not.toContain('sk-54321');
        expect(result.reason).toBe('[TOKEN redacted]');
        expect(result.source).toBe('[TOKEN redacted]');
    });

    test('removes headers and cookies', () => {
        expect(sanitizeReason('Error cookie: session=12345')).toBe('Error [AUTH redacted]');
        expect(sanitizeReason('Error Authorization: Basic abcdef')).toBe('Error [AUTH redacted]');
    });

    test('removes ALL control chars and newlines', () => {
        const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('') + String.fromCharCode(127);
        expect(sanitizeReason(`Line 1${controls}Line 2`)).toBe('Line 1 Line 2');
    });

    test('truncates to 160 chars', () => {
        const longStr = 'a'.repeat(200);
        const sanitized = sanitizeReason(longStr);
        expect(sanitized.length).toBe(160);
        expect(sanitized.endsWith('...')).toBe(true);
    });

    test('handles empty/null inputs', () => {
        expect(sanitizeReason(null)).toBe(null);
        expect(sanitizeReason(undefined)).toBe(null);
        expect(sanitizeReason('')).toBe(null);
        expect(sanitizeReason({ obj: true })).toBe(null);
        expect(sanitizeReason('   ')).toBe(null);
    });
});
