/* eslint-disable @next/internal/no-ambiguous-jsx -- whole module is used in React Client */ // Provider for the `useServerInsertedHTML` API to register callbacks to insert
// elements into the HTML stream.
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createServerInsertedHTML", {
    enumerable: true,
    get: function() {
        return createServerInsertedHTML;
    }
});
const _jsxruntime = require("react/jsx-runtime");
const _react = /*#__PURE__*/ _interop_require_wildcard(require("react"));
const _serverinsertedhtmlsharedruntime = require("../../shared/lib/server-inserted-html.shared-runtime");
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
function createServerInsertedHTML() {
    const serverInsertedHTMLCallbacks = [];
    const addInsertedHtml = (handler)=>{
        serverInsertedHTMLCallbacks.push(handler);
    };
    return {
        ServerInsertedHTMLProvider ({ children }) {
            return /*#__PURE__*/ (0, _jsxruntime.jsx)(_serverinsertedhtmlsharedruntime.ServerInsertedHTMLContext.Provider, {
                value: addInsertedHtml,
                children: children
            });
        },
        renderServerInsertedHTML () {
            return serverInsertedHTMLCallbacks.map((callback, index)=>/*#__PURE__*/ (0, _jsxruntime.jsx)(_react.Fragment, {
                    children: callback()
                }, '__next_server_inserted__' + index));
        }
    };
}

//# sourceMappingURL=server-inserted-html.js.map