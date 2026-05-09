"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    devirtualizeReactServerURL: null,
    filterStackFrameDEV: null,
    findApplicableSourceMapPayload: null,
    findSourceMapURLDEV: null,
    ignoreListAnonymousStackFramesIfSandwiched: null,
    sourceMapIgnoreListsEverything: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    devirtualizeReactServerURL: function() {
        return devirtualizeReactServerURL;
    },
    filterStackFrameDEV: function() {
        return filterStackFrameDEV;
    },
    findApplicableSourceMapPayload: function() {
        return findApplicableSourceMapPayload;
    },
    findSourceMapURLDEV: function() {
        return findSourceMapURLDEV;
    },
    ignoreListAnonymousStackFramesIfSandwiched: function() {
        return ignoreListAnonymousStackFramesIfSandwiched;
    },
    sourceMapIgnoreListsEverything: function() {
        return sourceMapIgnoreListsEverything;
    }
});
const _lrucache = require("./lru-cache");
function noSourceMap() {
    return undefined;
}
// Edge runtime does not implement `module`
const findSourceMap = process.env.NEXT_RUNTIME === 'edge' ? noSourceMap : require('module').findSourceMap;
function sourceMapIgnoreListsEverything(sourceMap) {
    return sourceMap.ignoreList !== undefined && sourceMap.sources.length === sourceMap.ignoreList.length;
}
function findApplicableSourceMapPayload(line0, column0, payload) {
    if ('sections' in payload) {
        if (payload.sections.length === 0) {
            return undefined;
        }
        // Sections must not overlap and must be sorted: https://tc39.es/source-map/#section-object
        // Therefore the last section that has an offset less than or equal to the frame is the applicable one.
        const sections = payload.sections;
        let left = 0;
        let right = sections.length - 1;
        let result = null;
        while(left <= right){
            // fast Math.floor
            const middle = ~~((left + right) / 2);
            const section = sections[middle];
            const offset = section.offset;
            if (offset.line < line0 || offset.line === line0 && offset.column <= column0) {
                result = section;
                left = middle + 1;
            } else {
                right = middle - 1;
            }
        }
        return result === null ? undefined : result.map;
    } else {
        return payload;
    }
}
const didWarnAboutInvalidSourceMapDEV = new Set();
function filterStackFrameDEV(sourceURL, functionName, line1, column1) {
    if (sourceURL === '') {
        // The default implementation filters out <anonymous> stack frames
        // but we want to retain them because current Server Components and
        // built-in Components in parent stacks don't have source location.
        // Filter out frames that show up in Promises to get good names in React's
        // Server Request track until we come up with a better heuristic.
        return functionName !== 'new Promise';
    }
    if (sourceURL.startsWith('node:') || sourceURL.includes('node_modules')) {
        return false;
    }
    try {
        // Node.js loads source maps eagerly so this call is cheap.
        // TODO: ESM sourcemaps are O(1) but CommonJS sourcemaps are O(Number of CJS modules).
        // Make sure this doesn't adversely affect performance when CJS is used by Next.js.
        const sourceMap = findSourceMap(sourceURL);
        if (sourceMap === undefined) {
            // No source map assoicated.
            // TODO: Node.js types should reflect that `findSourceMap` can return `undefined`.
            return true;
        }
        const sourceMapPayload = findApplicableSourceMapPayload(line1 - 1, column1 - 1, sourceMap.payload);
        if (sourceMapPayload === undefined) {
            // No source map section applicable to the frame.
            return true;
        }
        return !sourceMapIgnoreListsEverything(sourceMapPayload);
    } catch (cause) {
        if (process.env.NODE_ENV !== 'production') {
            // TODO: Share cache with patch-error-inspect
            if (!didWarnAboutInvalidSourceMapDEV.has(sourceURL)) {
                didWarnAboutInvalidSourceMapDEV.add(sourceURL);
                // We should not log an actual error instance here because that will re-enter
                // this codepath during error inspection and could lead to infinite recursion.
                console.error(`${sourceURL}: Invalid source map. Only conformant source maps can be used to filter stack frames. Cause: ${cause}`);
            }
        }
        return true;
    }
}
const invalidSourceMap = Symbol('invalid-source-map');
const sourceMapURLs = new _lrucache.LRUCache(512 * 1024 * 1024, (url)=>url === invalidSourceMap ? // so that we don't create a huge cache with empty source maps.
    8 * 1024 : url.length);
function findSourceMapURLDEV(scriptNameOrSourceURL) {
    let sourceMapURL = sourceMapURLs.get(scriptNameOrSourceURL);
    if (sourceMapURL === undefined) {
        let sourceMapPayload;
        try {
            var _findSourceMap;
            sourceMapPayload = (_findSourceMap = findSourceMap(scriptNameOrSourceURL)) == null ? void 0 : _findSourceMap.payload;
        } catch (cause) {
            console.error(`${scriptNameOrSourceURL}: Invalid source map. Only conformant source maps can be used to find the original code. Cause: ${cause}`);
        }
        if (sourceMapPayload === undefined) {
            sourceMapURL = invalidSourceMap;
        } else {
            // TODO: Might be more efficient to extract the relevant section from Index Maps.
            // Unclear if that search is worth the smaller payload we have to stringify.
            const sourceMapJSON = JSON.stringify(sourceMapPayload);
            const sourceMapURLData = Buffer.from(sourceMapJSON, 'utf8').toString('base64');
            sourceMapURL = `data:application/json;base64,${sourceMapURLData}`;
        }
        sourceMapURLs.set(scriptNameOrSourceURL, sourceMapURL);
    }
    return sourceMapURL === invalidSourceMap ? null : sourceMapURL;
}
function devirtualizeReactServerURL(sourceURL) {
    if (sourceURL.startsWith('about://React/')) {
        // about://React/Server/file://<filename>?42 => file://<filename>
        const envIdx = sourceURL.indexOf('/', 'about://React/'.length);
        const suffixIdx = sourceURL.lastIndexOf('?');
        if (envIdx > -1 && suffixIdx > -1) {
            return decodeURI(sourceURL.slice(envIdx + 1, suffixIdx));
        }
    }
    return sourceURL;
}
function isAnonymousFrameLikelyJSNative(methodName) {
    // Anonymous frames can also be produced in React parent stacks either from
    // host components or Server Components. We don't want to ignore those.
    // This could hide user-space methods that are named like native JS methods but
    // should you really do that?
    return(// e.g. JSON.parse
    methodName.startsWith('JSON.') || // E.g. Promise.withResolves
    methodName.startsWith('Function.') || // various JS built-ins
    methodName.startsWith('Promise.') || methodName.startsWith('Array.') || methodName.startsWith('Set.') || methodName.startsWith('Map.'));
}
function ignoreListAnonymousStackFramesIfSandwiched(frames, isAnonymousFrame, isIgnoredFrame, getMethodName, /** only passes frames for which `isAnonymousFrame` and their method is a native JS method or `isIgnoredFrame` return true */ ignoreFrame) {
    for(let i = 1; i < frames.length; i++){
        const currentFrame = frames[i];
        if (!(isAnonymousFrame(currentFrame) && isAnonymousFrameLikelyJSNative(getMethodName(currentFrame)))) {
            continue;
        }
        const previousFrameIsIgnored = isIgnoredFrame(frames[i - 1]);
        if (previousFrameIsIgnored && i < frames.length - 1) {
            let ignoreSandwich = false;
            let j = i + 1;
            for(j; j < frames.length; j++){
                const nextFrame = frames[j];
                const nextFrameIsAnonymous = isAnonymousFrame(nextFrame) && isAnonymousFrameLikelyJSNative(getMethodName(nextFrame));
                if (nextFrameIsAnonymous) {
                    continue;
                }
                const nextFrameIsIgnored = isIgnoredFrame(nextFrame);
                if (nextFrameIsIgnored) {
                    ignoreSandwich = true;
                    break;
                }
            }
            if (ignoreSandwich) {
                for(i; i < j; i++){
                    ignoreFrame(frames[i]);
                }
            }
        }
    }
}

//# sourceMappingURL=source-maps.js.map