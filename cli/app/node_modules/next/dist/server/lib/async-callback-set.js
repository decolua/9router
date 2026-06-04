"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AsyncCallbackSet", {
    enumerable: true,
    get: function() {
        return AsyncCallbackSet;
    }
});
class AsyncCallbackSet {
    add(callback) {
        this.callbacks.push(callback);
    }
    async runAll() {
        if (!this.callbacks.length) {
            return;
        }
        const callbacks = this.callbacks;
        this.callbacks = [];
        await Promise.allSettled(callbacks.map(// NOTE: wrapped in an async function to protect against synchronous exceptions
        async (f)=>f()));
    }
    constructor(){
        this.callbacks = [];
    }
}

//# sourceMappingURL=async-callback-set.js.map