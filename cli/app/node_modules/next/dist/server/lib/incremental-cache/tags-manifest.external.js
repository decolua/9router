"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    areTagsExpired: null,
    areTagsStale: null,
    tagsManifest: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    areTagsExpired: function() {
        return areTagsExpired;
    },
    areTagsStale: function() {
        return areTagsStale;
    },
    tagsManifest: function() {
        return tagsManifest;
    }
});
const tagsManifest = new Map();
const areTagsExpired = (tags, timestamp)=>{
    for (const tag of tags){
        const entry = tagsManifest.get(tag);
        const expiredAt = entry == null ? void 0 : entry.expired;
        if (typeof expiredAt === 'number') {
            const now = Date.now();
            // For immediate expiration (expiredAt <= now) and tag was invalidated after entry was created
            // OR for future expiration that has now passed (expiredAt > timestamp && expiredAt <= now)
            const isImmediatelyExpired = expiredAt <= now && expiredAt > timestamp;
            if (isImmediatelyExpired) {
                return true;
            }
        }
    }
    return false;
};
const areTagsStale = (tags, timestamp)=>{
    for (const tag of tags){
        const entry = tagsManifest.get(tag);
        const staleAt = (entry == null ? void 0 : entry.stale) ?? 0;
        if (typeof staleAt === 'number' && staleAt > timestamp) {
            return true;
        }
    }
    return false;
};

//# sourceMappingURL=tags-manifest.external.js.map