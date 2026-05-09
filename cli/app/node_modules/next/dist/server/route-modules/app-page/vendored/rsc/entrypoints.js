"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    React: null,
    ReactCompilerRuntime: null,
    ReactDOM: null,
    ReactJsxDevRuntime: null,
    ReactJsxRuntime: null,
    ReactServerDOMTurbopackServer: null,
    ReactServerDOMTurbopackStatic: null,
    ReactServerDOMWebpackServer: null,
    ReactServerDOMWebpackStatic: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    React: function() {
        return _react;
    },
    ReactCompilerRuntime: function() {
        return _compilerruntime;
    },
    ReactDOM: function() {
        return _reactdom;
    },
    ReactJsxDevRuntime: function() {
        return _jsxdevruntime;
    },
    ReactJsxRuntime: function() {
        return _jsxruntime;
    },
    ReactServerDOMTurbopackServer: function() {
        return ReactServerDOMTurbopackServer;
    },
    ReactServerDOMTurbopackStatic: function() {
        return ReactServerDOMTurbopackStatic;
    },
    ReactServerDOMWebpackServer: function() {
        return ReactServerDOMWebpackServer;
    },
    ReactServerDOMWebpackStatic: function() {
        return ReactServerDOMWebpackStatic;
    }
});
const _react = /*#__PURE__*/ _interop_require_wildcard(require("react"));
const _reactdom = /*#__PURE__*/ _interop_require_wildcard(require("react-dom"));
const _jsxdevruntime = /*#__PURE__*/ _interop_require_wildcard(require("react/jsx-dev-runtime"));
const _jsxruntime = /*#__PURE__*/ _interop_require_wildcard(require("react/jsx-runtime"));
const _compilerruntime = /*#__PURE__*/ _interop_require_wildcard(require("react/compiler-runtime"));
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
function getAltProxyForBindingsDEV(type, pkg) {
    if (process.env.NODE_ENV === 'development') {
        const altType = type === 'Turbopack' ? 'Webpack' : 'Turbopack';
        const altPkg = pkg.replace(new RegExp(type, 'gi'), altType.toLowerCase());
        return new Proxy({}, {
            get (_, prop) {
                throw Object.defineProperty(new Error(`Expected to use ${type} bindings (${pkg}) for React but the current process is referencing '${prop}' from the ${altType} bindings (${altPkg}). This is likely a bug in our integration of the Next.js server runtime.`), "__NEXT_ERROR_CODE", {
                    value: "E253",
                    enumerable: false,
                    configurable: true
                });
            }
        });
    }
}
let ReactServerDOMTurbopackServer, ReactServerDOMWebpackServer;
let ReactServerDOMTurbopackStatic, ReactServerDOMWebpackStatic;
if (process.env.TURBOPACK) {
    ReactServerDOMTurbopackServer = // @ts-expect-error -- TODO: Add types
    // eslint-disable-next-line import/no-extraneous-dependencies
    require('react-server-dom-turbopack/server');
    if (process.env.NODE_ENV === 'development') {
        ReactServerDOMWebpackServer = getAltProxyForBindingsDEV('Turbopack', 'react-server-dom-turbopack/server');
    }
    ReactServerDOMTurbopackStatic = // @ts-expect-error -- TODO: Add types
    // eslint-disable-next-line import/no-extraneous-dependencies
    require('react-server-dom-turbopack/static');
    if (process.env.NODE_ENV === 'development') {
        ReactServerDOMWebpackStatic = getAltProxyForBindingsDEV('Turbopack', 'react-server-dom-turbopack/static');
    }
} else {
    ReactServerDOMWebpackServer = // eslint-disable-next-line import/no-extraneous-dependencies
    require('react-server-dom-webpack/server');
    if (process.env.NODE_ENV === 'development') {
        ReactServerDOMTurbopackServer = getAltProxyForBindingsDEV('Webpack', 'react-server-dom-webpack/server');
    }
    ReactServerDOMWebpackStatic = // eslint-disable-next-line import/no-extraneous-dependencies
    require('react-server-dom-webpack/static');
    if (process.env.NODE_ENV === 'development') {
        ReactServerDOMTurbopackStatic = getAltProxyForBindingsDEV('Webpack', 'react-server-dom-webpack/static');
    }
}

//# sourceMappingURL=entrypoints.js.map