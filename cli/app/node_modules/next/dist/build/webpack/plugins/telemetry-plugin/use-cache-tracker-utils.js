"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createUseCacheTracker: null,
    mergeUseCacheTrackers: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createUseCacheTracker: function() {
        return createUseCacheTracker;
    },
    mergeUseCacheTrackers: function() {
        return mergeUseCacheTrackers;
    }
});
const createUseCacheTracker = ()=>new Map();
const mergeUseCacheTrackers = (tracker1, tracker2)=>{
    const mergedTracker = {
        ...tracker1
    };
    if (tracker2) {
        for(const key in tracker2){
            if (Object.prototype.hasOwnProperty.call(tracker2, key)) {
                const typedKey = key;
                if (mergedTracker[typedKey] !== undefined) {
                    mergedTracker[typedKey] += tracker2[typedKey];
                } else {
                    mergedTracker[typedKey] = tracker2[typedKey];
                }
            }
        }
    }
    return mergedTracker;
};

//# sourceMappingURL=use-cache-tracker-utils.js.map