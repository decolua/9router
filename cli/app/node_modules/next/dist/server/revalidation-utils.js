"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    executeRevalidates: null,
    withExecuteRevalidates: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    executeRevalidates: function() {
        return executeRevalidates;
    },
    withExecuteRevalidates: function() {
        return withExecuteRevalidates;
    }
});
const _handlers = require("./use-cache/handlers");
async function withExecuteRevalidates(store, callback) {
    if (!store) {
        return callback();
    }
    // If we executed any revalidates during the request, then we don't want to execute them again.
    // save the state so we can check if anything changed after we're done running callbacks.
    const savedRevalidationState = cloneRevalidationState(store);
    try {
        return await callback();
    } finally{
        // Check if we have any new revalidates, and if so, wait until they are all resolved.
        const newRevalidates = diffRevalidationState(savedRevalidationState, cloneRevalidationState(store));
        await executeRevalidates(store, newRevalidates);
    }
}
function cloneRevalidationState(store) {
    return {
        pendingRevalidatedTags: store.pendingRevalidatedTags ? [
            ...store.pendingRevalidatedTags
        ] : [],
        pendingRevalidates: {
            ...store.pendingRevalidates
        },
        pendingRevalidateWrites: store.pendingRevalidateWrites ? [
            ...store.pendingRevalidateWrites
        ] : []
    };
}
function diffRevalidationState(prev, curr) {
    const prevTagsWithProfile = new Set(prev.pendingRevalidatedTags.map((item)=>{
        const profileKey = typeof item.profile === 'object' ? JSON.stringify(item.profile) : item.profile || '';
        return `${item.tag}:${profileKey}`;
    }));
    const prevRevalidateWrites = new Set(prev.pendingRevalidateWrites);
    return {
        pendingRevalidatedTags: curr.pendingRevalidatedTags.filter((item)=>{
            const profileKey = typeof item.profile === 'object' ? JSON.stringify(item.profile) : item.profile || '';
            return !prevTagsWithProfile.has(`${item.tag}:${profileKey}`);
        }),
        pendingRevalidates: Object.fromEntries(Object.entries(curr.pendingRevalidates).filter(([key])=>!(key in prev.pendingRevalidates))),
        pendingRevalidateWrites: curr.pendingRevalidateWrites.filter((promise)=>!prevRevalidateWrites.has(promise))
    };
}
async function revalidateTags(tagsWithProfile, incrementalCache, workStore) {
    if (tagsWithProfile.length === 0) {
        return;
    }
    const handlers = (0, _handlers.getCacheHandlers)();
    const promises = [];
    // Group tags by profile for batch processing
    const tagsByProfile = new Map();
    for (const item of tagsWithProfile){
        const profile = item.profile;
        // Find existing profile by comparing values
        let existingKey = undefined;
        for (const [key] of tagsByProfile){
            if (typeof key === 'string' && typeof profile === 'string' && key === profile) {
                existingKey = key;
                break;
            }
            if (typeof key === 'object' && typeof profile === 'object' && JSON.stringify(key) === JSON.stringify(profile)) {
                existingKey = key;
                break;
            }
            if (key === profile) {
                existingKey = key;
                break;
            }
        }
        const profileKey = existingKey || profile;
        if (!tagsByProfile.has(profileKey)) {
            tagsByProfile.set(profileKey, []);
        }
        tagsByProfile.get(profileKey).push(item.tag);
    }
    // Process each profile group
    for (const [profile, tagsForProfile] of tagsByProfile){
        // Look up the cache profile from workStore if available
        let durations;
        if (profile) {
            let cacheLife;
            if (typeof profile === 'object') {
                // Profile is already a cacheLife configuration object
                cacheLife = profile;
            } else if (typeof profile === 'string') {
                var _workStore_cacheLifeProfiles;
                // Profile is a string key, look it up in workStore
                cacheLife = workStore == null ? void 0 : (_workStore_cacheLifeProfiles = workStore.cacheLifeProfiles) == null ? void 0 : _workStore_cacheLifeProfiles[profile];
                if (!cacheLife) {
                    throw Object.defineProperty(new Error(`Invalid profile provided "${profile}" must be configured under cacheLife in next.config or be "max"`), "__NEXT_ERROR_CODE", {
                        value: "E873",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
            if (cacheLife) {
                durations = {
                    expire: cacheLife.expire
                };
            }
        }
        // If profile is not found and not 'max', durations will be undefined
        // which will trigger immediate expiration in the cache handler
        for (const handler of handlers || []){
            if (profile) {
                promises.push(handler.updateTags == null ? void 0 : handler.updateTags.call(handler, tagsForProfile, durations));
            } else {
                promises.push(handler.updateTags == null ? void 0 : handler.updateTags.call(handler, tagsForProfile));
            }
        }
        if (incrementalCache) {
            promises.push(incrementalCache.revalidateTag(tagsForProfile, durations));
        }
    }
    await Promise.all(promises);
}
function executeRevalidates(workStore, state) {
    const promises = [];
    const pendingRevalidatedTags = (state == null ? void 0 : state.pendingRevalidatedTags) ?? workStore.pendingRevalidatedTags ?? [];
    if (pendingRevalidatedTags.length > 0) {
        promises.push(revalidateTags(pendingRevalidatedTags, workStore.incrementalCache, workStore));
    }
    const pendingRevalidates = Object.values((state == null ? void 0 : state.pendingRevalidates) ?? workStore.pendingRevalidates ?? {});
    promises.push(...pendingRevalidates);
    const pendingRevalidateWrites = (state == null ? void 0 : state.pendingRevalidateWrites) ?? workStore.pendingRevalidateWrites ?? [];
    promises.push(...pendingRevalidateWrites);
    if (promises.length === 0) {
        return false;
    }
    return Promise.all(promises).then(()=>undefined);
}

//# sourceMappingURL=revalidation-utils.js.map