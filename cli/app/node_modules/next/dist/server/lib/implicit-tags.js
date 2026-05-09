"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getImplicitTags", {
    enumerable: true,
    get: function() {
        return getImplicitTags;
    }
});
const _constants = require("../../lib/constants");
const _handlers = require("../use-cache/handlers");
const _lazyresult = require("./lazy-result");
const getDerivedTags = (pathname)=>{
    const derivedTags = [
        `/layout`
    ];
    // we automatically add the current path segments as tags
    // for revalidatePath handling
    if (pathname.startsWith('/')) {
        const pathnameParts = pathname.split('/');
        for(let i = 1; i < pathnameParts.length + 1; i++){
            let curPathname = pathnameParts.slice(0, i).join('/');
            if (curPathname) {
                // all derived tags other than the page are layout tags
                if (!curPathname.endsWith('/page') && !curPathname.endsWith('/route')) {
                    curPathname = `${curPathname}${!curPathname.endsWith('/') ? '/' : ''}layout`;
                }
                derivedTags.push(curPathname);
            }
        }
    }
    return derivedTags;
};
/**
 * Creates a map with lazy results that fetch the expiration value for the given
 * tags and respective cache kind when they're awaited for the first time.
 */ function createTagsExpirationsByCacheKind(tags) {
    const expirationsByCacheKind = new Map();
    const cacheHandlers = (0, _handlers.getCacheHandlerEntries)();
    if (cacheHandlers) {
        for (const [kind, cacheHandler] of cacheHandlers){
            if ('getExpiration' in cacheHandler) {
                expirationsByCacheKind.set(kind, (0, _lazyresult.createLazyResult)(async ()=>cacheHandler.getExpiration(tags)));
            }
        }
    }
    return expirationsByCacheKind;
}
async function getImplicitTags(page, pathname, fallbackRouteParams) {
    const tags = new Set();
    // Add the derived tags from the page.
    const derivedTags = getDerivedTags(page);
    for (let tag of derivedTags){
        tag = `${_constants.NEXT_CACHE_IMPLICIT_TAG_ID}${tag}`;
        tags.add(tag);
    }
    // Add the tags from the pathname. If the route has unknown params, we don't
    // want to add the pathname as a tag, as it will be invalid.
    if (pathname && (!fallbackRouteParams || fallbackRouteParams.size === 0)) {
        const tag = `${_constants.NEXT_CACHE_IMPLICIT_TAG_ID}${pathname}`;
        tags.add(tag);
    }
    if (tags.has(`${_constants.NEXT_CACHE_IMPLICIT_TAG_ID}/`)) {
        tags.add(`${_constants.NEXT_CACHE_IMPLICIT_TAG_ID}/index`);
    }
    if (tags.has(`${_constants.NEXT_CACHE_IMPLICIT_TAG_ID}/index`)) {
        tags.add(`${_constants.NEXT_CACHE_IMPLICIT_TAG_ID}/`);
    }
    const tagsArray = Array.from(tags);
    return {
        tags: tagsArray,
        expirationsByCacheKind: createTagsExpirationsByCacheKind(tagsArray)
    };
}

//# sourceMappingURL=implicit-tags.js.map