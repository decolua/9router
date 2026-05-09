"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    StaleTimeIterable: null,
    createSelectStaleTime: null,
    finishStaleTimeTracking: null,
    trackStaleTime: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    StaleTimeIterable: function() {
        return StaleTimeIterable;
    },
    createSelectStaleTime: function() {
        return createSelectStaleTime;
    },
    finishStaleTimeTracking: function() {
        return finishStaleTimeTracking;
    },
    trackStaleTime: function() {
        return trackStaleTime;
    }
});
const _constants = require("../../lib/constants");
class StaleTimeIterable {
    update(value) {
        if (this._done) return;
        this.currentValue = value;
        if (this._resolve) {
            this._resolve({
                value,
                done: false
            });
            this._resolve = null;
        } else {
            this._buffer.push(value);
        }
    }
    close() {
        if (this._done) return;
        this._done = true;
        if (this._resolve) {
            this._resolve({
                value: undefined,
                done: true
            });
            this._resolve = null;
        }
    }
    [Symbol.asyncIterator]() {
        return {
            next: ()=>{
                if (this._buffer.length > 0) {
                    return Promise.resolve({
                        value: this._buffer.shift(),
                        done: false
                    });
                }
                if (this._done) {
                    return Promise.resolve({
                        value: undefined,
                        done: true
                    });
                }
                return new Promise((resolve)=>{
                    this._resolve = resolve;
                });
            }
        };
    }
    constructor(){
        this._resolve = null;
        this._done = false;
        this._buffer = [];
        /** The last value passed to `update()`. */ this.currentValue = 0;
    }
}
function createSelectStaleTime(experimental) {
    return (stale)=>{
        var _experimental_staleTimes;
        return stale === _constants.INFINITE_CACHE && typeof ((_experimental_staleTimes = experimental.staleTimes) == null ? void 0 : _experimental_staleTimes.static) === 'number' ? experimental.staleTimes.static : stale;
    };
}
function trackStaleTime(store, iterable, selectStaleTime) {
    let _stale = store.stale;
    iterable.update(selectStaleTime(_stale));
    Object.defineProperty(store, 'stale', {
        get: ()=>_stale,
        set: (value)=>{
            _stale = value;
            iterable.update(selectStaleTime(value));
        },
        configurable: true,
        enumerable: true
    });
}
async function finishStaleTimeTracking(iterable) {
    iterable.close();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

//# sourceMappingURL=stale-time.js.map