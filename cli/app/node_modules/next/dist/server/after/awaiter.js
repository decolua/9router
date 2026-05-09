"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    AwaiterMulti: null,
    AwaiterOnce: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    AwaiterMulti: function() {
        return AwaiterMulti;
    },
    AwaiterOnce: function() {
        return AwaiterOnce;
    }
});
const _invarianterror = require("../../shared/lib/invariant-error");
class AwaiterMulti {
    constructor({ onError } = {}){
        this.promises = new Set();
        this.waitUntil = (promise)=>{
            // if a promise settles before we await it, we should drop it --
            // storing them indefinitely could result in a memory leak.
            const cleanup = ()=>{
                this.promises.delete(promise);
            };
            promise.then(cleanup, (err)=>{
                cleanup();
                this.onError(err);
            });
            this.promises.add(promise);
        };
        this.onError = onError ?? console.error;
    }
    async awaiting() {
        while(this.promises.size > 0){
            const promises = Array.from(this.promises);
            this.promises.clear();
            await Promise.allSettled(promises);
        }
    }
}
class AwaiterOnce {
    constructor(options = {}){
        this.done = false;
        this.waitUntil = (promise)=>{
            if (this.done) {
                throw Object.defineProperty(new _invarianterror.InvariantError('Cannot call waitUntil() on an AwaiterOnce that was already awaited'), "__NEXT_ERROR_CODE", {
                    value: "E563",
                    enumerable: false,
                    configurable: true
                });
            }
            return this.awaiter.waitUntil(promise);
        };
        this.awaiter = new AwaiterMulti(options);
    }
    async awaiting() {
        if (!this.pending) {
            this.pending = this.awaiter.awaiting().finally(()=>{
                this.done = true;
            });
        }
        return this.pending;
    }
}

//# sourceMappingURL=awaiter.js.map