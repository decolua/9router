/**
 * Navigation lock for the Instant Navigation Testing API.
 *
 * Manages the in-memory lock (a promise) that gates dynamic data writes
 * during instant navigation captures, and owns all cookie state
 * transitions (pending → captured-MPA, pending → captured-SPA).
 *
 * External actors (Playwright, devtools) set [0] to start a lock scope
 * and delete the cookie to end one. Next.js writes captured values.
 * The CookieStore handler distinguishes them by value: pending = external,
 * captured = self-write (ignored).
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    isNavigationLocked: null,
    startListeningForInstantNavigationCookie: null,
    transitionToCapturedSPA: null,
    updateCapturedSPAToTree: null,
    waitForNavigationLockIfActive: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    isNavigationLocked: function() {
        return isNavigationLocked;
    },
    startListeningForInstantNavigationCookie: function() {
        return startListeningForInstantNavigationCookie;
    },
    transitionToCapturedSPA: function() {
        return transitionToCapturedSPA;
    },
    updateCapturedSPAToTree: function() {
        return updateCapturedSPAToTree;
    },
    waitForNavigationLockIfActive: function() {
        return waitForNavigationLockIfActive;
    }
});
const _approuterheaders = require("../app-router-headers");
const _useactionqueue = require("../use-action-queue");
function parseCookieValue(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length >= 3) {
            const rawState = parsed[2];
            return rawState === null ? 'mpa' : 'spa';
        }
    } catch  {}
    return 'pending';
}
function writeCookieValue(value) {
    if (typeof cookieStore === 'undefined') {
        return;
    }
    // Read the existing cookie to preserve its attributes (domain, path),
    // then write back with the new value. This updates the same cookie
    // entry that the external actor created, regardless of how it was
    // scoped.
    cookieStore.get(_approuterheaders.NEXT_INSTANT_TEST_COOKIE).then((existing)=>{
        if (existing) {
            const options = {
                name: _approuterheaders.NEXT_INSTANT_TEST_COOKIE,
                value: JSON.stringify(value),
                path: existing.path ?? '/'
            };
            if (existing.domain) {
                options.domain = existing.domain;
            }
            cookieStore.set(options);
        }
    });
}
let lockState = null;
function acquireLock() {
    if (lockState !== null) {
        return;
    }
    let resolve;
    const promise = new Promise((r)=>{
        resolve = r;
    });
    lockState = {
        promise,
        resolve: resolve
    };
}
function releaseLock() {
    if (lockState !== null) {
        lockState.resolve();
        lockState = null;
    }
}
function startListeningForInstantNavigationCookie() {
    if (process.env.__NEXT_EXPOSE_TESTING_API) {
        // If the server served a static shell, this is an MPA page load
        // while the lock is held. Transition to captured-MPA and acquire.
        if (self.__next_instant_test) {
            if (typeof cookieStore !== 'undefined') {
                // If the cookie was already cleared during the MPA page
                // transition, reload to get the full dynamic page.
                cookieStore.get(_approuterheaders.NEXT_INSTANT_TEST_COOKIE).then((cookie)=>{
                    if (!cookie) {
                        window.location.reload();
                    }
                });
            }
            writeCookieValue([
                1,
                `c${Math.random()}`,
                null
            ]);
            acquireLock();
        }
        if (typeof cookieStore === 'undefined') {
            return;
        }
        cookieStore.addEventListener('change', (event)=>{
            for (const cookie of event.changed){
                if (cookie.name === _approuterheaders.NEXT_INSTANT_TEST_COOKIE) {
                    const state = parseCookieValue(cookie.value ?? '');
                    if (state !== 'pending') {
                        // Captured value — our own transition. Ignore.
                        return;
                    }
                    // Pending value — external actor starting a new lock scope.
                    if (lockState !== null) {
                        releaseLock();
                    }
                    acquireLock();
                    return;
                }
            }
            for (const cookie of event.deleted){
                if (cookie.name === _approuterheaders.NEXT_INSTANT_TEST_COOKIE) {
                    releaseLock();
                    (0, _useactionqueue.refreshOnInstantNavigationUnlock)();
                    return;
                }
            }
        });
    }
}
function transitionToCapturedSPA(fromTree, toTree) {
    if (process.env.__NEXT_EXPOSE_TESTING_API) {
        writeCookieValue([
            1,
            `c${Math.random()}`,
            {
                from: fromTree,
                to: toTree
            }
        ]);
    }
}
function updateCapturedSPAToTree(fromTree, toTree) {
    if (process.env.__NEXT_EXPOSE_TESTING_API) {
        writeCookieValue([
            1,
            `c${Math.random()}`,
            {
                from: fromTree,
                to: toTree
            }
        ]);
    }
}
function isNavigationLocked() {
    if (process.env.__NEXT_EXPOSE_TESTING_API) {
        return lockState !== null;
    }
    return false;
}
async function waitForNavigationLockIfActive() {
    if (process.env.__NEXT_EXPOSE_TESTING_API) {
        if (lockState !== null) {
            await lockState.promise;
        }
    }
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=navigation-testing-lock.js.map