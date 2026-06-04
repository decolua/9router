"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    stripInternalQueries: null,
    stripInternalSearchParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    stripInternalQueries: function() {
        return stripInternalQueries;
    },
    stripInternalSearchParams: function() {
        return stripInternalSearchParams;
    }
});
const _approuterheaders = require("../client/components/app-router-headers");
const INTERNAL_QUERY_NAMES = [
    _approuterheaders.NEXT_RSC_UNION_QUERY
];
function stripInternalQueries(query) {
    for (const name of INTERNAL_QUERY_NAMES){
        delete query[name];
    }
}
function stripInternalSearchParams(url) {
    const isStringUrl = typeof url === 'string';
    const instance = isStringUrl ? new URL(url) : url;
    instance.searchParams.delete(_approuterheaders.NEXT_RSC_UNION_QUERY);
    return isStringUrl ? instance.toString() : instance;
}

//# sourceMappingURL=internal-utils.js.map