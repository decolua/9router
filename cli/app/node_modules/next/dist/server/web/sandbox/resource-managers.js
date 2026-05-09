"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    intervalsManager: null,
    timeoutsManager: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    intervalsManager: function() {
        return intervalsManager;
    },
    timeoutsManager: function() {
        return timeoutsManager;
    }
});
class ResourceManager {
    add(resourceArgs) {
        const resource = this.create(resourceArgs);
        this.resources.push(resource);
        return resource;
    }
    remove(resource) {
        this.resources = this.resources.filter((r)=>r !== resource);
        this.destroy(resource);
    }
    removeAll() {
        this.resources.forEach(this.destroy);
        this.resources = [];
    }
    constructor(){
        this.resources = [];
    }
}
class IntervalsManager extends ResourceManager {
    create(args) {
        // TODO: use the edge runtime provided `setInterval` instead
        return webSetIntervalPolyfill(...args);
    }
    destroy(interval) {
        clearInterval(interval);
    }
}
class TimeoutsManager extends ResourceManager {
    create(args) {
        // TODO: use the edge runtime provided `setTimeout` instead
        return webSetTimeoutPolyfill(...args);
    }
    destroy(timeout) {
        clearTimeout(timeout);
    }
}
function webSetIntervalPolyfill(callback, ms, ...args) {
    return setInterval(()=>{
        // node's `setInterval` sets `this` to the `Timeout` instance it returned,
        // but web `setInterval` always sets `this` to `window`
        // see: https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval#the_this_problem
        return callback.apply(globalThis, args);
    }, ms)[Symbol.toPrimitive]();
}
function webSetTimeoutPolyfill(callback, ms, ...args) {
    const wrappedCallback = ()=>{
        try {
            // node's `setTimeout` sets `this` to the `Timeout` instance it returned,
            // but web `setTimeout` always sets `this` to `window`
            // see: https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#the_this_problem
            return callback.apply(globalThis, args);
        } finally{
            // On certain older node versions (<20.16.0, <22.4.0),
            // a `setTimeout` whose Timeout was converted to a primitive will leak.
            // See: https://github.com/nodejs/node/issues/53335
            // We can work around this by explicitly calling `clearTimeout` after the callback runs.
            clearTimeout(timeout);
        }
    };
    const timeout = setTimeout(wrappedCallback, ms);
    return timeout[Symbol.toPrimitive]();
}
const intervalsManager = new IntervalsManager();
const timeoutsManager = new TimeoutsManager();

//# sourceMappingURL=resource-managers.js.map