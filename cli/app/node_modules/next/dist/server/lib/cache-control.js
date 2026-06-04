"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getCacheControlHeader", {
    enumerable: true,
    get: function() {
        return getCacheControlHeader;
    }
});
const _constants = require("../../lib/constants");
function getCacheControlHeader({ revalidate, expire }) {
    const swrHeader = typeof revalidate === 'number' && expire !== undefined && revalidate < expire ? `, stale-while-revalidate=${expire - revalidate}` : '';
    if (revalidate === 0) {
        return 'private, no-cache, no-store, max-age=0, must-revalidate';
    } else if (typeof revalidate === 'number') {
        return `s-maxage=${revalidate}${swrHeader}`;
    }
    return `s-maxage=${_constants.CACHE_ONE_YEAR_SECONDS}${swrHeader}`;
}

//# sourceMappingURL=cache-control.js.map