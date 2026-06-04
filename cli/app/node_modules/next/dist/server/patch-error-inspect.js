"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    patchErrorInspectEdgeLite: null,
    patchErrorInspectNodeJS: null,
    setBundlerFindSourceMapImplementation: null,
    setCodeFrameRenderer: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    patchErrorInspectEdgeLite: function() {
        return patchErrorInspectEdgeLite;
    },
    patchErrorInspectNodeJS: function() {
        return patchErrorInspectNodeJS;
    },
    setBundlerFindSourceMapImplementation: function() {
        return setBundlerFindSourceMapImplementation;
    },
    setCodeFrameRenderer: function() {
        return setCodeFrameRenderer;
    }
});
const _module = require("module");
const _path = /*#__PURE__*/ _interop_require_wildcard(require("path"));
const _url = /*#__PURE__*/ _interop_require_wildcard(require("url"));
const _sourcemap = require("next/dist/compiled/source-map");
const _sourcemaps = require("./lib/source-maps");
const _parsestack = require("./lib/parse-stack");
const _workunitasyncstorageexternal = require("./app-render/work-unit-async-storage.external");
const _picocolors = require("../lib/picocolors");
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
// Find a source map using the bundler's API.
// This is only a fallback for when Node.js fails to due to bugs e.g. https://github.com/nodejs/node/issues/52102
// TODO: Remove once all supported Node.js versions are fixed.
// TODO(veil): Set from Webpack as well
let bundlerFindSourceMapPayload = ()=>undefined;
function setBundlerFindSourceMapImplementation(findSourceMapImplementation) {
    bundlerFindSourceMapPayload = findSourceMapImplementation;
}
let codeFrameRenderer;
function setCodeFrameRenderer(renderer) {
    codeFrameRenderer = renderer;
}
function getOriginalCodeFrame(frame, source, colors = process.stdout.isTTY) {
    if (!codeFrameRenderer) {
        // No renderer available - gracefully degrade
        return null;
    }
    return codeFrameRenderer(frame, source, colors);
}
function frameToString(methodName, sourceURL, line1, column1) {
    let sourceLocation = line1 !== null ? `:${line1}` : '';
    if (column1 !== null && sourceLocation !== '') {
        sourceLocation += `:${column1}`;
    }
    let fileLocation;
    if (sourceURL !== null && sourceURL.startsWith('file://') && URL.canParse(sourceURL)) {
        // If not relative to CWD, the path is ambiguous to IDEs and clicking will prompt to select the file first.
        // In a multi-app repo, this leads to potentially larger file names but will make clicking snappy.
        // There's no tradeoff for the cases where `dir` in `next dev [dir]` is omitted
        // since relative to cwd is both the shortest and snappiest.
        fileLocation = _path.relative(process.cwd(), _url.fileURLToPath(sourceURL));
    } else if (sourceURL !== null && sourceURL.startsWith('/')) {
        fileLocation = _path.relative(process.cwd(), sourceURL);
    } else {
        fileLocation = sourceURL;
    }
    return methodName ? `    at ${methodName} (${fileLocation}${sourceLocation})` : `    at ${fileLocation}${sourceLocation}`;
}
function computeErrorName(error) {
    // TODO: Node.js seems to use a different algorithm
    // class ReadonlyRequestCookiesError extends Error {}` would read `ReadonlyRequestCookiesError: [...]`
    // in the stack i.e. seems like under certain conditions it favors the constructor name.
    return error.name || 'Error';
}
function prepareUnsourcemappedStackTrace(error, structuredStackTrace) {
    const name = computeErrorName(error);
    const message = error.message || '';
    let stack = name + ': ' + message;
    for(let i = 0; i < structuredStackTrace.length; i++){
        stack += '\n    at ' + structuredStackTrace[i].toString();
    }
    return stack;
}
function shouldIgnoreListGeneratedFrame(file) {
    return file.startsWith('node:') || file.includes('node_modules');
}
function shouldIgnoreListOriginalFrame(file) {
    return file.includes('node_modules');
}
function createUnsourcemappedFrame(frame) {
    return {
        stack: {
            file: frame.file,
            line1: frame.line1,
            column1: frame.column1,
            methodName: frame.methodName,
            arguments: frame.arguments,
            ignored: shouldIgnoreListGeneratedFrame(frame.file)
        },
        code: null
    };
}
function ignoreListAnonymousStackFramesIfSandwiched(sourceMappedFrames) {
    return (0, _sourcemaps.ignoreListAnonymousStackFramesIfSandwiched)(sourceMappedFrames, (frame)=>frame.stack.file === '<anonymous>', (frame)=>frame.stack.ignored, (frame)=>frame.stack.methodName, (frame)=>{
        frame.stack.ignored = true;
    });
}
/**
 * @param frame
 * @param sourceMapCache
 * @returns The original frame if not sourcemapped.
 */ function getSourcemappedFrameIfPossible(frame, sourceMapCache, inspectOptions) {
    var _frame_methodName_replace, _frame_methodName;
    const sourceMapCacheEntry = sourceMapCache.get(frame.file);
    let sourceMapConsumer;
    let sourceMapPayload;
    if (sourceMapCacheEntry === undefined) {
        let sourceURL = frame.file;
        // e.g. "/Users/foo/APP/.next/server/chunks/ssr/[root-of-the-server]__2934a0._.js"
        // or "C:\Users\foo\APP\.next\server\chunks\ssr\[root-of-the-server]__2934a0._.js"
        // will be keyed by Node.js as "file:///APP/.next/server/chunks/ssr/[root-of-the-server]__2934a0._.js".
        // This is likely caused by `callsite.toString()` in `Error.prepareStackTrace converting file URLs to paths.
        //
        // But frame.file might also be "webpack-internal:///(rsc)/./app/bad-sourcemap/page.js" or
        // "<anonymous>" or "node:internal/process/task_queues" here
        if (_path.isAbsolute(frame.file)) {
            sourceURL = _url.pathToFileURL(frame.file).toString();
        }
        let maybeSourceMapPayload;
        try {
            const sourceMap = (0, _module.findSourceMap)(sourceURL);
            maybeSourceMapPayload = sourceMap == null ? void 0 : sourceMap.payload;
        } catch (cause) {
            // We should not log an actual error instance here because that will re-enter
            // this codepath during error inspection and could lead to infinite recursion.
            console.error(`${sourceURL}: Invalid source map. Only conformant source maps can be used to find the original code. Cause: ${cause}`);
            // If loading fails once, it'll fail every time.
            // So set the cache to avoid duplicate errors.
            sourceMapCache.set(frame.file, null);
            // Don't even fall back to the bundler because it might be not as strict
            // with regards to parsing and then we fail later once we consume the
            // source map payload.
            // This essentially avoids a redundant error where we fail here and then
            // later on consumption because the bundler just handed back an invalid
            // source map.
            return createUnsourcemappedFrame(frame);
        }
        if (maybeSourceMapPayload === undefined) {
            maybeSourceMapPayload = bundlerFindSourceMapPayload(sourceURL);
        }
        if (maybeSourceMapPayload === undefined) {
            return createUnsourcemappedFrame(frame);
        }
        sourceMapPayload = maybeSourceMapPayload;
        try {
            // Pass the source map URL as the second parameter so that the consumer
            // can resolve relative paths in the source map's `sources` array. This is
            // a guess! Turbopack places .map files as siblings to the chunks so this
            // is sufficient to compute relative paths but is actually wrong (the
            // chunk and sourcemap have different content hashes). We are using the
            // node API to read the sourcemap and it doesn't give us access to the
            // URI. Devirtualize `about://React/Server/file:///path/to/chunk.js?4` to
            // `file:///path/to/chunk.js` so that relative `sources` in the source map
            // resolve against the real chunk URL, not the virtual one.
            const sourceMapURL = (0, _sourcemaps.devirtualizeReactServerURL)(sourceURL) + '.map';
            sourceMapConsumer = new _sourcemap.SourceMapConsumer(sourceMapPayload, // @ts-expect-error: our typings don't include this parameter but it is here.
            sourceMapURL);
        } catch (cause) {
            // We should not log an actual error instance here because that will re-enter
            // this codepath during error inspection and could lead to infinite recursion.
            console.error(`${sourceURL}: Invalid source map. Only conformant source maps can be used to find the original code. Cause: ${cause}`);
            // If creating the consumer fails once, it'll fail every time.
            // So set the cache to avoid duplicate errors.
            sourceMapCache.set(frame.file, null);
            return createUnsourcemappedFrame(frame);
        }
        sourceMapCache.set(frame.file, {
            map: sourceMapConsumer,
            payload: sourceMapPayload
        });
    } else if (sourceMapCacheEntry === null) {
        // We failed earlier getting the payload or consumer.
        // Just return an unsourcemapped frame.
        // Errors will already be logged.
        return createUnsourcemappedFrame(frame);
    } else {
        sourceMapConsumer = sourceMapCacheEntry.map;
        sourceMapPayload = sourceMapCacheEntry.payload;
    }
    const sourcePosition = sourceMapConsumer.originalPositionFor({
        column: (frame.column1 ?? 1) - 1,
        line: frame.line1 ?? 1
    });
    const applicableSourceMap = (0, _sourcemaps.findApplicableSourceMapPayload)((frame.line1 ?? 1) - 1, (frame.column1 ?? 1) - 1, sourceMapPayload);
    let ignored = applicableSourceMap !== undefined && (0, _sourcemaps.sourceMapIgnoreListsEverything)(applicableSourceMap);
    if (sourcePosition.source === null) {
        return {
            stack: {
                arguments: frame.arguments,
                file: frame.file,
                line1: frame.line1,
                column1: frame.column1,
                methodName: frame.methodName,
                ignored: ignored || shouldIgnoreListGeneratedFrame(frame.file)
            },
            code: null
        };
    }
    // TODO(veil): Upstream a method to sourcemap consumer that immediately says if a frame is ignored or not.
    if (applicableSourceMap === undefined) {
        console.error('No applicable source map found in sections for frame', frame);
    } else if (!ignored && shouldIgnoreListOriginalFrame(sourcePosition.source)) {
        // Externals may be libraries that don't ship ignoreLists.
        // This is really taking control away from libraries.
        // They should still ship `ignoreList` so that attached debuggers ignore-list their frames.
        // TODO: Maybe only ignore library sourcemaps if `ignoreList` is absent?
        // Though keep in mind that Turbopack omits empty `ignoreList`.
        // So if we establish this convention, we should communicate it to the ecosystem.
        ignored = true;
    } else if (!ignored) {
        var _applicableSourceMap_ignoreList;
        // TODO: O(n^2). Consider moving `ignoreList` into a Set
        const sourceIndex = applicableSourceMap.sources.indexOf(sourcePosition.source);
        ignored = ((_applicableSourceMap_ignoreList = applicableSourceMap.ignoreList) == null ? void 0 : _applicableSourceMap_ignoreList.includes(sourceIndex)) ?? false;
    }
    const originalFrame = {
        // We ignore the sourcemapped name since it won't be the correct name.
        // The callsite will point to the column of the variable name instead of the
        // name of the enclosing function.
        // TODO(NDX-531): Spy on prepareStackTrace to get the enclosing line number for method name mapping.
        methodName: (_frame_methodName = frame.methodName) == null ? void 0 : (_frame_methodName_replace = _frame_methodName.replace('__WEBPACK_DEFAULT_EXPORT__', 'default')) == null ? void 0 : _frame_methodName_replace.replace('__webpack_exports__.', ''),
        file: sourcePosition.source,
        line1: sourcePosition.line,
        column1: sourcePosition.column + 1,
        // TODO: c&p from async createOriginalStackFrame but why not frame.arguments?
        arguments: [],
        ignored
    };
    /** undefined = not yet computed */ let codeFrame;
    return {
        stack: originalFrame,
        get code () {
            if (codeFrame === undefined) {
                const sourceContent = sourceMapConsumer.sourceContentFor(sourcePosition.source, /* returnNullOnMissing */ true) ?? null;
                codeFrame = getOriginalCodeFrame(originalFrame, sourceContent, inspectOptions.colors);
            }
            return codeFrame;
        }
    };
}
function parseAndSourceMap(error, inspectOptions) {
    const showIgnoreListed = process.env.__NEXT_SHOW_IGNORE_LISTED === 'true';
    // We overwrote Error.prepareStackTrace earlier so error.stack is not sourcemapped.
    let unparsedStack = String(error.stack);
    // We could just read it from `error.stack`.
    // This works around cases where a 3rd party `Error.prepareStackTrace` implementation
    // doesn't implement the name computation correctly.
    const errorName = computeErrorName(error);
    let idx = unparsedStack.indexOf('react_stack_bottom_frame');
    if (idx !== -1) {
        idx = unparsedStack.lastIndexOf('\n', idx);
    } else {
        idx = unparsedStack.indexOf('react-stack-bottom-frame');
        if (idx !== -1) {
            idx = unparsedStack.lastIndexOf('\n', idx);
        }
    }
    if (idx !== -1 && !showIgnoreListed) {
        // Cut off everything after the bottom frame since it'll be React internals.
        unparsedStack = unparsedStack.slice(0, idx);
    }
    const unsourcemappedStack = (0, _parsestack.parseStack)(unparsedStack);
    const sourceMapCache = new Map();
    const sourceMappedFrames = [];
    let sourceFrame = null;
    for (const frame of unsourcemappedStack){
        if (frame.file === null) {
            sourceMappedFrames.push({
                code: null,
                stack: {
                    file: frame.file,
                    line1: frame.line1,
                    column1: frame.column1,
                    methodName: frame.methodName,
                    arguments: frame.arguments,
                    ignored: false
                }
            });
        } else {
            const sourcemappedFrame = getSourcemappedFrameIfPossible(// We narrowed this earlier by bailing if `frame.file` is null.
            frame, sourceMapCache, inspectOptions);
            sourceMappedFrames.push(sourcemappedFrame);
            // We can determine the sourceframe here.
            // anonymous frames won't have a sourceframe so we don't need to scan
            // all stacks again to check if they are sandwiched between ignored frames.
            if (sourceFrame === null && // TODO: Is this the right choice?
            !sourcemappedFrame.stack.ignored && sourcemappedFrame.code !== null) {
                sourceFrame = sourcemappedFrame.code;
            }
        }
    }
    ignoreListAnonymousStackFramesIfSandwiched(sourceMappedFrames);
    let sourceMappedStack = '';
    for(let i = 0; i < sourceMappedFrames.length; i++){
        const frame = sourceMappedFrames[i];
        if (!frame.stack.ignored) {
            sourceMappedStack += '\n' + frameToString(frame.stack.methodName, frame.stack.file, frame.stack.line1, frame.stack.column1);
        } else if (showIgnoreListed) {
            sourceMappedStack += '\n' + (0, _picocolors.dim)(frameToString(frame.stack.methodName, frame.stack.file, frame.stack.line1, frame.stack.column1));
        }
    }
    if (sourceMappedStack === '' && sourceMappedFrames.length > 0) {
        // The `at` marker is important so that Node.js doesn't add square brackets
        // around the stringified error i.e. this results in
        // Error: message
        //   at <ignore-listed frames>
        // instead of
        // [Error: message
        //   at <ignore-listed frames>]
        sourceMappedStack = '\n    at ' + (0, _picocolors.italic)('ignore-listed frames');
    }
    return errorName + ': ' + error.message + sourceMappedStack + (sourceFrame !== null ? '\n' + sourceFrame : '');
}
function sourceMapError(error, inspectOptions) {
    // Setting an undefined `cause` would print `[cause]: undefined`
    const options = error.cause !== undefined ? {
        cause: error.cause
    } : undefined;
    // Create a new Error object with the source mapping applied and then use native
    // Node.js formatting on the result.
    const newError = error instanceof AggregateError ? Object.defineProperty(new AggregateError(error.errors, error.message, options), "__NEXT_ERROR_CODE", {
        value: "E394",
        enumerable: false,
        configurable: true
    }) : Object.defineProperty(new Error(error.message, options), "__NEXT_ERROR_CODE", {
        value: "E394",
        enumerable: false,
        configurable: true
    });
    // TODO: Ensure `class MyError extends Error {}` prints `MyError` as the name
    newError.stack = parseAndSourceMap(error, inspectOptions);
    for(const key in error){
        if (!Object.prototype.hasOwnProperty.call(newError, key)) {
            // @ts-expect-error -- We're copying all enumerable properties.
            // So they definitely exist on `this` and obviously have no type on `newError` (yet)
            newError[key] = error[key];
        }
    }
    return newError;
}
function patchErrorInspectNodeJS(errorConstructor) {
    const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');
    errorConstructor.prepareStackTrace = prepareUnsourcemappedStackTrace;
    // @ts-expect-error -- TODO upstream types
    errorConstructor.prototype[inspectSymbol] = function(depth, inspectOptions, inspect) {
        // avoid false-positive dynamic i/o warnings e.g. due to usage of `Math.random` in `source-map`.
        return _workunitasyncstorageexternal.workUnitAsyncStorage.exit(()=>{
            const newError = sourceMapError(this, inspectOptions);
            const originalCustomInspect = newError[inspectSymbol];
            // Prevent infinite recursion.
            // { customInspect: false } would result in `error.cause` not using our inspect.
            Object.defineProperty(newError, inspectSymbol, {
                value: undefined,
                enumerable: false,
                writable: true
            });
            try {
                return inspect(newError, {
                    ...inspectOptions,
                    depth
                });
            } finally{
                ;
                newError[inspectSymbol] = originalCustomInspect;
            }
        });
    };
}
function patchErrorInspectEdgeLite(errorConstructor) {
    const inspectSymbol = Symbol.for('edge-runtime.inspect.custom');
    errorConstructor.prepareStackTrace = prepareUnsourcemappedStackTrace;
    // @ts-expect-error -- TODO upstream types
    errorConstructor.prototype[inspectSymbol] = function({ format }) {
        // avoid false-positive dynamic i/o warnings e.g. due to usage of `Math.random` in `source-map`.
        return _workunitasyncstorageexternal.workUnitAsyncStorage.exit(()=>{
            const newError = sourceMapError(this, {});
            const originalCustomInspect = newError[inspectSymbol];
            // Prevent infinite recursion.
            Object.defineProperty(newError, inspectSymbol, {
                value: undefined,
                enumerable: false,
                writable: true
            });
            try {
                return format(newError);
            } finally{
                ;
                newError[inspectSymbol] = originalCustomInspect;
            }
        });
    };
}

//# sourceMappingURL=patch-error-inspect.js.map