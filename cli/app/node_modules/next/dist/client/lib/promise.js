"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "resolvePromiseWithTimeout", {
    enumerable: true,
    get: function() {
        return resolvePromiseWithTimeout;
    }
});
const _requestidlecallback = require("../request-idle-callback");
// 3.8s was arbitrarily chosen as it's what https://web.dev/interactive
// considers as "Good" time-to-interactive. We must assume something went
// wrong beyond this point, and then fall-back to a full page transition to
// show the user something of value.
const MS_MAX_IDLE_DELAY = 3800;
function resolvePromiseWithTimeout(p, err, devPromise) {
    return new Promise((resolve, reject)=>{
        let cancelled = false;
        p.then((r)=>{
            // Resolved, cancel the timeout
            cancelled = true;
            resolve(r);
        }).catch(reject);
        // We wrap these checks separately for better dead-code elimination in
        // production bundles.
        if (process.env.NODE_ENV === 'development') {
            ;
            (devPromise || Promise.resolve()).then(()=>{
                (0, _requestidlecallback.requestIdleCallback)(()=>setTimeout(()=>{
                        if (!cancelled) {
                            reject(err);
                        }
                    }, MS_MAX_IDLE_DELAY));
            });
        }
        if (process.env.NODE_ENV !== 'development') {
            (0, _requestidlecallback.requestIdleCallback)(()=>setTimeout(()=>{
                    if (!cancelled) {
                        reject(err);
                    }
                }, MS_MAX_IDLE_DELAY));
        }
    });
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=promise.js.map