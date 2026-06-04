"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createAppRouterApiAliases: null,
    createNextApiEsmAliases: null,
    createServerOnlyClientOnlyAliases: null,
    createVendoredReactAliases: null,
    createWebpackAliases: null,
    getOptimizedModuleAliases: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createAppRouterApiAliases: function() {
        return createAppRouterApiAliases;
    },
    createNextApiEsmAliases: function() {
        return createNextApiEsmAliases;
    },
    createServerOnlyClientOnlyAliases: function() {
        return createServerOnlyClientOnlyAliases;
    },
    createVendoredReactAliases: function() {
        return createVendoredReactAliases;
    },
    createWebpackAliases: function() {
        return createWebpackAliases;
    },
    getOptimizedModuleAliases: function() {
        return getOptimizedModuleAliases;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _react = /*#__PURE__*/ _interop_require_wildcard(require("react"));
const _constants = require("../lib/constants");
const _requirehook = require("../server/require-hook");
const _webpackconfig = require("./webpack-config");
const _nextdirpaths = require("./next-dir-paths");
const _utils = require("./utils");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
const isReact19 = typeof _react.use === 'function';
function createWebpackAliases({ distDir, isClient, isEdgeServer, dev, config, pagesDir, appDir, dir, reactProductionProfiling }) {
    const pageExtensions = config.pageExtensions;
    const customAppAliases = {};
    const customDocumentAliases = {};
    // tell webpack where to look for _app and _document
    // using aliases to allow falling back to the default
    // version when removed or not present
    if (dev) {
        const nextDistPath = 'next/dist/' + (isEdgeServer ? 'esm/' : '');
        customAppAliases[`${_constants.PAGES_DIR_ALIAS}/_app`] = [
            ...pagesDir ? pageExtensions.reduce((prev, ext)=>{
                prev.push(_path.default.join(pagesDir, `_app.${ext}`));
                return prev;
            }, []) : [],
            `${nextDistPath}pages/_app.js`
        ];
        customAppAliases[`${_constants.PAGES_DIR_ALIAS}/_error`] = [
            ...pagesDir ? pageExtensions.reduce((prev, ext)=>{
                prev.push(_path.default.join(pagesDir, `_error.${ext}`));
                return prev;
            }, []) : [],
            `${nextDistPath}pages/_error.js`
        ];
        customDocumentAliases[`${_constants.PAGES_DIR_ALIAS}/_document`] = [
            ...pagesDir ? pageExtensions.reduce((prev, ext)=>{
                prev.push(_path.default.join(pagesDir, `_document.${ext}`));
                return prev;
            }, []) : [],
            `${nextDistPath}pages/_document.js`
        ];
    }
    return {
        '@vercel/og$': 'next/dist/server/og/image-response',
        // Avoid bundling both entrypoints in React 19 when we just need one.
        // Also avoids bundler warnings in React 18 where react-dom/server.edge doesn't exist.
        'next/dist/server/ReactDOMServerPages': isReact19 ? 'react-dom/server.edge' : 'react-dom/server.browser',
        // Alias next/dist imports to next/dist/esm assets,
        // let this alias hit before `next` alias.
        ...isEdgeServer ? {
            'next/dist/api': 'next/dist/esm/api',
            'next/dist/build': 'next/dist/esm/build',
            'next/dist/client': 'next/dist/esm/client',
            'next/dist/shared': 'next/dist/esm/shared',
            'next/dist/pages': 'next/dist/esm/pages',
            'next/dist/lib': 'next/dist/esm/lib',
            'next/dist/server': 'next/dist/esm/server',
            ...createNextApiEsmAliases()
        } : undefined,
        // For RSC server bundle
        ...!(0, _webpackconfig.hasExternalOtelApiPackage)() && {
            '@opentelemetry/api': 'next/dist/compiled/@opentelemetry/api'
        },
        ...config.images.loaderFile ? {
            'next/dist/shared/lib/image-loader': config.images.loaderFile,
            ...isEdgeServer && {
                'next/dist/esm/shared/lib/image-loader': config.images.loaderFile
            }
        } : undefined,
        'styled-jsx/style$': _requirehook.defaultOverrides['styled-jsx/style'],
        'styled-jsx$': _requirehook.defaultOverrides['styled-jsx'],
        'next/dist/compiled/next-devtools': isClient ? 'next/dist/compiled/next-devtools' : 'next/dist/next-devtools/dev-overlay.shim.js',
        ...customAppAliases,
        ...customDocumentAliases,
        ...pagesDir ? {
            [_constants.PAGES_DIR_ALIAS]: pagesDir
        } : {},
        ...appDir ? {
            [_constants.APP_DIR_ALIAS]: appDir
        } : {},
        [_constants.ROOT_DIR_ALIAS]: dir,
        ...isClient ? {
            'private-next-instrumentation-client': [
                _path.default.join(dir, 'src', 'instrumentation-client'),
                _path.default.join(dir, 'instrumentation-client'),
                'private-next-empty-module'
            ],
            // disable typechecker, webpack5 allows aliases to be set to false to create a no-op module
            'private-next-empty-module': false
        } : {},
        [_constants.DOT_NEXT_ALIAS]: distDir,
        ...isClient || isEdgeServer ? getOptimizedModuleAliases() : {},
        ...reactProductionProfiling ? getReactProfilingInProduction() : {},
        [_constants.RSC_ACTION_VALIDATE_ALIAS]: 'next/dist/build/webpack/loaders/next-flight-loader/action-validate',
        [_constants.RSC_ACTION_CLIENT_WRAPPER_ALIAS]: 'next/dist/build/webpack/loaders/next-flight-loader/action-client-wrapper',
        [_constants.RSC_ACTION_PROXY_ALIAS]: 'next/dist/build/webpack/loaders/next-flight-loader/server-reference',
        [_constants.RSC_ACTION_ENCRYPTION_ALIAS]: 'next/dist/server/app-render/encryption',
        [_constants.RSC_CACHE_WRAPPER_ALIAS]: 'next/dist/build/webpack/loaders/next-flight-loader/cache-wrapper',
        [_constants.RSC_DYNAMIC_IMPORT_WRAPPER_ALIAS]: 'next/dist/build/webpack/loaders/next-flight-loader/track-dynamic-import',
        '@swc/helpers/_': _path.default.join(_path.default.dirname(require.resolve('@swc/helpers/package.json')), '_'),
        setimmediate: 'next/dist/compiled/setimmediate'
    };
}
function createServerOnlyClientOnlyAliases(isServer) {
    return isServer ? {
        'server-only$': 'next/dist/compiled/server-only/empty',
        'client-only$': 'next/dist/compiled/client-only/error',
        'next/dist/compiled/server-only$': 'next/dist/compiled/server-only/empty',
        'next/dist/compiled/client-only$': 'next/dist/compiled/client-only/error'
    } : {
        'server-only$': 'next/dist/compiled/server-only/index',
        'client-only$': 'next/dist/compiled/client-only/index',
        'next/dist/compiled/client-only$': 'next/dist/compiled/client-only/index',
        'next/dist/compiled/server-only': 'next/dist/compiled/server-only/index'
    };
}
function createNextApiEsmAliases() {
    const mapping = {
        error: 'next/dist/api/error',
        head: 'next/dist/api/head',
        image: 'next/dist/api/image',
        constants: 'next/dist/api/constants',
        router: 'next/dist/api/router',
        dynamic: 'next/dist/api/dynamic',
        script: 'next/dist/api/script',
        link: 'next/dist/api/link',
        form: 'next/dist/api/form',
        navigation: 'next/dist/api/navigation',
        headers: 'next/dist/api/headers',
        og: 'next/dist/api/og',
        server: 'next/dist/api/server',
        // pages api
        document: 'next/dist/api/document',
        app: 'next/dist/api/app'
    };
    const aliasMap = {};
    // Handle fully specified imports like `next/image.js`
    for (const [key, value] of Object.entries(mapping)){
        const nextApiFilePath = _path.default.join(_nextdirpaths.NEXT_PROJECT_ROOT, key);
        aliasMap[nextApiFilePath + '.js'] = value;
    }
    return aliasMap;
}
function createAppRouterApiAliases(isServerOnlyLayer) {
    const mapping = {
        head: 'next/dist/client/components/noop-head',
        dynamic: 'next/dist/api/app-dynamic',
        link: 'next/dist/client/app-dir/link',
        form: 'next/dist/client/app-dir/form'
    };
    if (isServerOnlyLayer) {
        mapping['error'] = 'next/dist/api/error.react-server';
        mapping['navigation'] = 'next/dist/api/navigation.react-server';
        mapping['link'] = 'next/dist/client/app-dir/link.react-server';
    }
    const aliasMap = {};
    for (const [key, value] of Object.entries(mapping)){
        const nextApiFilePath = _path.default.join(_nextdirpaths.NEXT_PROJECT_ROOT, key);
        aliasMap[nextApiFilePath + '.js'] = value;
    }
    return aliasMap;
}
function createVendoredReactAliases(bundledReactChannel, { layer, isBrowser, isEdgeServer, reactProductionProfiling }) {
    const environmentCondition = isBrowser ? 'browser' : isEdgeServer ? 'edge' : 'nodejs';
    const reactCondition = (0, _utils.shouldUseReactServerCondition)(layer) ? 'server' : 'client';
    // ✅ Correct alias
    // ❌ Incorrect alias i.e. importing this entrypoint should throw an error.
    // ❔ Alias that may produce correct code in certain conditions.Keep until react-markup is available.
    let reactAlias;
    if (environmentCondition === 'browser' && reactCondition === 'client') {
        // prettier-ignore
        reactAlias = {
            // file:///./../compiled/react/package.json
            react$: /* ✅ */ `next/dist/compiled/react${bundledReactChannel}`,
            'react/compiler-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/compiler-runtime`,
            'react/jsx-dev-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/jsx-dev-runtime`,
            'react/jsx-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/jsx-runtime`,
            // file:///./../compiled/react-dom/package.json
            'react-dom$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}`,
            'react-dom/client$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/client`,
            'react-dom/server$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            'react-dom/server.browser$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            // optimizations to ignore the legacy build of react-dom/server in `server.edge` build
            'react-dom/server.edge$': /* ❌ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/static$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.browser$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.edge$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            // file:///./../compiled/react-server-dom-webpack/package.json
            'react-server-dom-webpack/client$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/client.browser`,
            'react-server-dom-webpack/server$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.browser`,
            'react-server-dom-webpack/server.node$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.node`,
            'react-server-dom-webpack/static$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/static.browser`
        };
    } else if (environmentCondition === 'browser' && reactCondition === 'server') {
        // prettier-ignore
        reactAlias = {
            // file:///./../compiled/react/package.json
            react$: /* ❌ */ `next/dist/compiled/react${bundledReactChannel}`,
            'react/compiler-runtime$': /* ❌ */ `next/dist/compiled/react${bundledReactChannel}/compiler-runtime`,
            'react/jsx-dev-runtime$': /* ❌ */ `next/dist/compiled/react${bundledReactChannel}/jsx-dev-runtime`,
            'react/jsx-runtime$': /* ❌ */ `next/dist/compiled/react${bundledReactChannel}/jsx-runtime`,
            // file:///./../compiled/react-dom/package.json
            'react-dom$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}`,
            'react-dom/client$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/client`,
            'react-dom/server$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            'react-dom/server.browser$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            // optimizations to ignore the legacy build of react-dom/server in `server.edge` build
            'react-dom/server.edge$': /* ❌ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/static$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.browser$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.edge$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            // file:///./../compiled/react-server-dom-webpack/package.json
            'react-server-dom-webpack/client$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/client.browser`,
            'react-server-dom-webpack/server$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.browser`,
            'react-server-dom-webpack/server.node$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.node`,
            'react-server-dom-webpack/static$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/static.browser`
        };
    } else if (environmentCondition === 'nodejs' && reactCondition === 'client') {
        // prettier-ignore
        reactAlias = {
            // file:///./../compiled/react/package.json
            react$: /* ✅ */ `next/dist/server/route-modules/app-page/vendored/ssr/react`,
            'react/compiler-runtime$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/ssr/react-compiler-runtime`,
            'react/jsx-dev-runtime$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime`,
            'react/jsx-runtime$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-runtime`,
            // file:///./../compiled/react-dom/package.json
            'react-dom$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/ssr/react-dom`,
            'react-dom/client$': /* ❔ */ `next/dist/compiled/react-dom${bundledReactChannel}/client`,
            'react-dom/server$': /* ❔ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.node`,
            'react-dom/server.browser$': /* ❔ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            // optimizations to ignore the legacy build of react-dom/server in `server.edge` build
            'react-dom/server.edge$': /* ✅ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/static$': /* ❔ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.node`,
            'react-dom/static.browser$': /* ❔ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.edge$': /* ❔ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            // file:///./../compiled/react-server-dom-webpack/package.json
            'react-server-dom-webpack/client$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/ssr/react-server-dom-webpack-client`,
            'react-server-dom-webpack/server$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.node`,
            'react-server-dom-webpack/server.node$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.node`,
            'react-server-dom-webpack/static$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/static.node`
        };
    } else if (environmentCondition === 'nodejs' && reactCondition === 'server') {
        // prettier-ignore
        reactAlias = {
            // file:///./../compiled/react/package.json
            react$: /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react`,
            'react/compiler-runtime$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react-compiler-runtime`,
            'react/jsx-dev-runtime$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime`,
            'react/jsx-runtime$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-runtime`,
            // file:///./../compiled/react-dom/package.json
            'react-dom$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react-dom`,
            'react-dom/client$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/client`,
            'react-dom/server$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.node`,
            'react-dom/server.browser$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            // optimizations to ignore the legacy build of react-dom/server in `server.edge` build
            'react-dom/server.edge$': /* ❌ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/static$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.node`,
            'react-dom/static.browser$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.edge$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            // file:///./../compiled/react-server-dom-webpack/package.json
            'react-server-dom-webpack/client$': /* ❔ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/client.node`,
            'react-server-dom-webpack/server$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-webpack-server`,
            'react-server-dom-webpack/server.node$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-webpack-server`,
            'react-server-dom-webpack/static$': /* ✅ */ `next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-webpack-static`
        };
    } else if (environmentCondition === 'edge' && reactCondition === 'client') {
        // prettier-ignore
        reactAlias = {
            // file:///./../compiled/react/package.json
            react$: /* ✅ */ `next/dist/compiled/react${bundledReactChannel}`,
            'react/compiler-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/compiler-runtime`,
            'react/jsx-dev-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/jsx-dev-runtime`,
            'react/jsx-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/jsx-runtime`,
            // file:///./../compiled/react-dom/package.json
            'react-dom$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}`,
            'react-dom/client$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/client`,
            'react-dom/server$': /* ✅ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/server.browser$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            // optimizations to ignore the legacy build of react-dom/server in `server.edge` build
            'react-dom/server.edge$': /* ✅ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/static$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            'react-dom/static.browser$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.edge$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            // file:///./../compiled/react-server-dom-webpack/package.json
            'react-server-dom-webpack/client$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/client.edge`,
            'react-server-dom-webpack/server$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.edge`,
            'react-server-dom-webpack/server.node$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.node`,
            'react-server-dom-webpack/static$': /* ❌ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/static.edge`
        };
    } else if (environmentCondition === 'edge' && reactCondition === 'server') {
        // prettier-ignore
        reactAlias = {
            // file:///./../compiled/react/package.json
            react$: /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/react.react-server`,
            'react/compiler-runtime$': /* ❌ */ `next/dist/compiled/react${bundledReactChannel}/compiler-runtime`,
            'react/jsx-dev-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/jsx-dev-runtime.react-server`,
            'react/jsx-runtime$': /* ✅ */ `next/dist/compiled/react${bundledReactChannel}/jsx-runtime.react-server`,
            // file:///./../compiled/react-dom/package.json
            'react-dom$': /* ✅ */ `next/dist/compiled/react-dom${bundledReactChannel}/react-dom.react-server`,
            'react-dom/client$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/client`,
            'react-dom/server$': /* ❌ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/server.browser$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/server.browser`,
            // optimizations to ignore the legacy build of react-dom/server in `server.edge` build
            'react-dom/server.edge$': /* ❌ */ `next/dist/build/webpack/alias/react-dom-server${bundledReactChannel}.js`,
            'react-dom/static$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            'react-dom/static.browser$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.browser`,
            'react-dom/static.edge$': /* ❌ */ `next/dist/compiled/react-dom${bundledReactChannel}/static.edge`,
            // file:///./../compiled/react-server-dom-webpack/package.json
            'react-server-dom-webpack/client$': /* ❔ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/client.edge`,
            'react-server-dom-webpack/server$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.edge`,
            'react-server-dom-webpack/server.node$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/server.node`,
            'react-server-dom-webpack/static$': /* ✅ */ `next/dist/compiled/react-server-dom-webpack${bundledReactChannel}/static.edge`
        };
        // prettier-ignore
        reactAlias[`next/dist/compiled/react${bundledReactChannel}$`] = reactAlias[`react$`];
        // prettier-ignore
        reactAlias[`next/dist/compiled/react${bundledReactChannel}/compiler-runtime$`] = reactAlias[`react/compiler-runtime$`];
        // prettier-ignore
        reactAlias[`next/dist/compiled/react${bundledReactChannel}/jsx-dev-runtime$`] = reactAlias[`react/jsx-dev-runtime$`];
        // prettier-ignore
        reactAlias[`next/dist/compiled/react${bundledReactChannel}/jsx-runtime$`] = reactAlias[`react/jsx-runtime$`];
        // prettier-ignore
        reactAlias[`next/dist/compiled/react-dom${bundledReactChannel}$`] = reactAlias[`react-dom$`];
    } else {
        throw Object.defineProperty(new Error(`Unsupported environment condition "${environmentCondition}" and react condition "${reactCondition}". This is a bug in Next.js.`), "__NEXT_ERROR_CODE", {
            value: "E717",
            enumerable: false,
            configurable: true
        });
    }
    if (reactProductionProfiling) {
        reactAlias['react-dom/client$'] = `next/dist/compiled/react-dom${bundledReactChannel}/profiling`;
    }
    const alias = reactAlias;
    alias['@vercel/turbopack-ecmascript-runtime/browser/dev/hmr-client/hmr-client.ts'] = `next/dist/client/dev/noop-turbopack-hmr`;
    return alias;
}
function getOptimizedModuleAliases() {
    return {
        unfetch: require.resolve('next/dist/build/polyfills/fetch/index.js'),
        'isomorphic-unfetch': require.resolve('next/dist/build/polyfills/fetch/index.js'),
        'whatwg-fetch': require.resolve('next/dist/build/polyfills/fetch/whatwg-fetch.js'),
        'object-assign': require.resolve('next/dist/build/polyfills/object-assign.js'),
        'object.assign/auto': require.resolve('next/dist/build/polyfills/object.assign/auto.js'),
        'object.assign/implementation': require.resolve('next/dist/build/polyfills/object.assign/implementation.js'),
        'object.assign/polyfill': require.resolve('next/dist/build/polyfills/object.assign/polyfill.js'),
        'object.assign/shim': require.resolve('next/dist/build/polyfills/object.assign/shim.js'),
        url: require.resolve('next/dist/compiled/native-url')
    };
}
function getReactProfilingInProduction() {
    return {
        'react-dom/client$': 'react-dom/profiling'
    };
}

//# sourceMappingURL=create-compiler-aliases.js.map