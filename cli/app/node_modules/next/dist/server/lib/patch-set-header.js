"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "patchSetHeaderWithCookieSupport", {
    enumerable: true,
    get: function() {
        return patchSetHeaderWithCookieSupport;
    }
});
const _requestmeta = require("../request-meta");
function patchSetHeaderWithCookieSupport(req, res) {
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value)=>{
        // When renders /_error after page is failed, it could attempt to set
        // headers after headers.
        if ('headersSent' in res && res.headersSent) {
            return res;
        }
        if (name.toLowerCase() === 'set-cookie') {
            const middlewareValue = (0, _requestmeta.getRequestMeta)(req, 'middlewareCookie');
            if (!middlewareValue || !Array.isArray(value) || !value.every((item, idx)=>item === middlewareValue[idx])) {
                value = [
                    // TODO: (wyattjoh) find out why this is called multiple times resulting in duplicate cookies being added
                    ...new Set([
                        ...middlewareValue || [],
                        ...typeof value === 'string' ? [
                            value
                        ] : Array.isArray(value) ? value : []
                    ])
                ];
            }
        }
        return setHeader(name, value);
    };
}

//# sourceMappingURL=patch-set-header.js.map