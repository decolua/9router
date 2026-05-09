"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getBabelLoader: null,
    getReactCompilerLoader: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getBabelLoader: function() {
        return getBabelLoader;
    },
    getReactCompilerLoader: function() {
        return getReactCompilerLoader;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function getReactCompiler() {
    try {
        return require.resolve('babel-plugin-react-compiler');
    } catch  {
        throw Object.defineProperty(new Error('Failed to load the `babel-plugin-react-compiler`. It is required to use the React Compiler. Please install it.'), "__NEXT_ERROR_CODE", {
            value: "E78",
            enumerable: false,
            configurable: true
        });
    }
}
const getReactCompilerPlugins = (maybeOptions, isServer, isDev)=>{
    if (!maybeOptions || isServer) {
        return undefined;
    }
    const environment = {
        enableNameAnonymousFunctions: isDev
    };
    const options = typeof maybeOptions === 'boolean' ? {} : maybeOptions;
    const compilerOptions = {
        ...options,
        environment
    };
    return [
        [
            getReactCompiler(),
            compilerOptions
        ]
    ];
};
const getBabelLoader = (useSWCLoader, babelConfigFile, isServer, distDir, pagesDir, cwd, srcDir, dev, isClient, reactCompilerOptions, reactCompilerExclude)=>{
    if (!useSWCLoader) {
        // Make sure these options are kept in sync with
        // `packages/next/src/build/get-babel-loader-config.ts`
        const options = {
            transformMode: 'default',
            configFile: babelConfigFile,
            isServer,
            distDir,
            pagesDir,
            cwd,
            srcDir: _path.default.dirname(srcDir),
            development: dev,
            hasReactRefresh: dev && isClient,
            hasJsxRuntime: true,
            reactCompilerPlugins: getReactCompilerPlugins(reactCompilerOptions, isServer, dev),
            reactCompilerExclude
        };
        return {
            loader: require.resolve('./babel/loader/index'),
            options
        };
    }
    return undefined;
};
/**
 * Get a separate babel loader for the react compiler, only used if Babel is not
 * configured through e.g. .babelrc. If user have babel config, this should be configured in the babel loader itself.
 * Note from react compiler:
 * > For best results, compiler must run as the first plugin in your Babel pipeline so it receives input as close to the original source as possible.
 */ const getReactCompilerLoader = (reactCompilerOptions, cwd, isServer, reactCompilerExclude, isDev)=>{
    const reactCompilerPlugins = getReactCompilerPlugins(reactCompilerOptions, isServer, isDev);
    if (!reactCompilerPlugins) {
        return undefined;
    }
    const babelLoaderOptions = {
        transformMode: 'standalone',
        cwd,
        reactCompilerPlugins,
        isServer
    };
    if (reactCompilerExclude) {
        babelLoaderOptions.reactCompilerExclude = reactCompilerExclude;
    }
    return {
        loader: require.resolve('./babel/loader/index'),
        options: babelLoaderOptions
    };
};

//# sourceMappingURL=get-babel-loader-config.js.map