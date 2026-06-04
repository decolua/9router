"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "runInSequentialTasks", {
    enumerable: true,
    get: function() {
        return runInSequentialTasks;
    }
});
const _invarianterror = require("../../shared/lib/invariant-error");
const _apprenderscheduling = require("./app-render-scheduling");
const _fastsetimmediateexternal = require("../node-environment-extensions/fast-set-immediate.external");
const _isthenable = require("../../shared/lib/is-thenable");
function noop() {}
function runInSequentialTasks(first, ...rest) {
    if (process.env.NEXT_RUNTIME === 'edge') {
        throw Object.defineProperty(new _invarianterror.InvariantError('`runInSequentialTasks` should not be called in edge runtime.'), "__NEXT_ERROR_CODE", {
            value: "E1054",
            enumerable: false,
            configurable: true
        });
    } else {
        return new Promise((resolve, reject)=>{
            const scheduleTimeout = (0, _apprenderscheduling.createAtomicTimerGroup)();
            const ids = [];
            let result;
            ids.push(scheduleTimeout(()=>{
                try {
                    (0, _fastsetimmediateexternal.DANGEROUSLY_runPendingImmediatesAfterCurrentTask)();
                    result = first();
                    // If the first function returns a thenable, suppress unhandled
                    // rejections. A later task in the sequence (e.g. an abort) may
                    // cause the promise to reject, and we don't want that to surface
                    // as an unhandled rejection — the caller will observe the
                    // rejection when they await the returned promise.
                    if ((0, _isthenable.isThenable)(result)) {
                        result.then(noop, noop);
                    }
                } catch (err) {
                    for(let i = 1; i < ids.length; i++){
                        clearTimeout(ids[i]);
                    }
                    reject(err);
                }
            }));
            for(let i = 0; i < rest.length; i++){
                const fn = rest[i];
                let index = ids.length;
                ids.push(scheduleTimeout(()=>{
                    try {
                        (0, _fastsetimmediateexternal.DANGEROUSLY_runPendingImmediatesAfterCurrentTask)();
                        fn();
                    } catch (err) {
                        // clear remaining timeouts
                        while(++index < ids.length){
                            clearTimeout(ids[index]);
                        }
                        reject(err);
                    }
                }));
            }
            // We wait a task before resolving
            ids.push(scheduleTimeout(()=>{
                try {
                    (0, _fastsetimmediateexternal.expectNoPendingImmediates)();
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            }));
        });
    }
}

//# sourceMappingURL=app-render-render-utils.js.map