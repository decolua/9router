"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    AppRouterContext: null,
    HeadManagerContext: null,
    HooksClientContext: null,
    ImageConfigContext: null,
    RouterContext: null,
    ServerInsertedHtml: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    AppRouterContext: function() {
        return _approutercontextsharedruntime;
    },
    HeadManagerContext: function() {
        return _headmanagercontextsharedruntime;
    },
    HooksClientContext: function() {
        return _hooksclientcontextsharedruntime;
    },
    ImageConfigContext: function() {
        return _imageconfigcontextsharedruntime;
    },
    RouterContext: function() {
        return _routercontextsharedruntime;
    },
    ServerInsertedHtml: function() {
        return _serverinsertedhtmlsharedruntime;
    }
});
const _headmanagercontextsharedruntime = /*#__PURE__*/ _interop_require_wildcard(require("../../../../../shared/lib/head-manager-context.shared-runtime"));
const _serverinsertedhtmlsharedruntime = /*#__PURE__*/ _interop_require_wildcard(require("../../../../../shared/lib/server-inserted-html.shared-runtime"));
const _approutercontextsharedruntime = /*#__PURE__*/ _interop_require_wildcard(require("../../../../../shared/lib/app-router-context.shared-runtime"));
const _hooksclientcontextsharedruntime = /*#__PURE__*/ _interop_require_wildcard(require("../../../../../shared/lib/hooks-client-context.shared-runtime"));
const _routercontextsharedruntime = /*#__PURE__*/ _interop_require_wildcard(require("../../../../../shared/lib/router-context.shared-runtime"));
const _imageconfigcontextsharedruntime = /*#__PURE__*/ _interop_require_wildcard(require("../../../../../shared/lib/image-config-context.shared-runtime"));
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}

//# sourceMappingURL=entrypoints.js.map