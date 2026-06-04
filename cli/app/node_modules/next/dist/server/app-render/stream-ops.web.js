/**
 * Web stream operations for the rendering pipeline.
 * Loaded by stream-ops.ts (re-export in this PR, conditional switcher later).
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    chainStreams: null,
    continueDynamicHTMLResume: null,
    continueDynamicPrerender: null,
    continueFizzStream: null,
    continueStaticFallbackPrerender: null,
    continueStaticPrerender: null,
    createDocumentClosingStream: null,
    createInlinedDataStream: null,
    createOnHeadersCallback: null,
    createPendingStream: null,
    getClientPrerender: null,
    getServerPrerender: null,
    nodeReadableToWeb: null,
    pipeRuntimePrefetchTransform: null,
    processPrelude: null,
    renderToFizzStream: null,
    renderToFlightStream: null,
    resumeAndAbort: null,
    resumeToFizzStream: null,
    streamToBuffer: null,
    streamToString: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    chainStreams: function() {
        return _nodewebstreamshelper.chainStreams;
    },
    continueDynamicHTMLResume: function() {
        return _nodewebstreamshelper.continueDynamicHTMLResume;
    },
    continueDynamicPrerender: function() {
        return _nodewebstreamshelper.continueDynamicPrerender;
    },
    continueFizzStream: function() {
        return continueFizzStream;
    },
    continueStaticFallbackPrerender: function() {
        return _nodewebstreamshelper.continueStaticFallbackPrerender;
    },
    continueStaticPrerender: function() {
        return _nodewebstreamshelper.continueStaticPrerender;
    },
    createDocumentClosingStream: function() {
        return _nodewebstreamshelper.createDocumentClosingStream;
    },
    createInlinedDataStream: function() {
        return createInlinedDataStream;
    },
    createOnHeadersCallback: function() {
        return createOnHeadersCallback;
    },
    createPendingStream: function() {
        return createPendingStream;
    },
    getClientPrerender: function() {
        return getClientPrerender;
    },
    getServerPrerender: function() {
        return getServerPrerender;
    },
    nodeReadableToWeb: function() {
        return nodeReadableToWeb;
    },
    pipeRuntimePrefetchTransform: function() {
        return pipeRuntimePrefetchTransform;
    },
    processPrelude: function() {
        return _apprenderprerenderutils.processPrelude;
    },
    renderToFizzStream: function() {
        return renderToFizzStream;
    },
    renderToFlightStream: function() {
        return renderToFlightStream;
    },
    resumeAndAbort: function() {
        return resumeAndAbort;
    },
    resumeToFizzStream: function() {
        return resumeToFizzStream;
    },
    streamToBuffer: function() {
        return _nodewebstreamshelper.streamToBuffer;
    },
    streamToString: function() {
        return streamToString;
    }
});
const _server = require("react-dom/server");
const _static = require("react-dom/static");
const _nodewebstreamshelper = require("../stream-utils/node-web-streams-helper");
const _useflightresponse = require("./use-flight-response");
const _apprenderprerenderutils = require("./app-render-prerender-utils");
function continueFizzStream(renderStream, opts) {
    return (0, _nodewebstreamshelper.continueFizzStream)(renderStream, opts);
}
const nodeReadableToWeb = undefined;
function createInlinedDataStream(source, nonce, formState) {
    return (0, _useflightresponse.createInlinedDataReadableStream)(source, nonce, formState);
}
function createPendingStream() {
    return new ReadableStream();
}
function createOnHeadersCallback(appendHeader) {
    return (headers)=>{
        headers.forEach((value, key)=>{
            appendHeader(key, value);
        });
    };
}
async function resumeAndAbort(element, postponed, opts) {
    return (0, _server.resume)(element, postponed, opts);
}
function renderToFlightStream(ComponentMod, payload, clientModules, opts) {
    return ComponentMod.renderToReadableStream(payload, clientModules, opts);
}
async function streamToString(stream) {
    return (0, _nodewebstreamshelper.streamToString)(stream);
}
async function renderToFizzStream(element, streamOptions) {
    const stream = await (0, _nodewebstreamshelper.renderToInitialFizzStream)({
        ReactDOMServer: {
            renderToReadableStream: _server.renderToReadableStream
        },
        element,
        streamOptions
    });
    return {
        stream,
        allReady: stream.allReady,
        abort: undefined
    };
}
async function resumeToFizzStream(element, postponedState, streamOptions) {
    const stream = await (0, _server.resume)(element, postponedState, streamOptions);
    return {
        stream,
        allReady: stream.allReady,
        abort: undefined
    };
}
function getServerPrerender(ComponentMod) {
    return ComponentMod.prerender;
}
const getClientPrerender = _static.prerender;
function pipeRuntimePrefetchTransform(stream, sentinel, isPartial, staleTime) {
    return stream.pipeThrough((0, _nodewebstreamshelper.createRuntimePrefetchTransformStream)(sentinel, isPartial, staleTime));
}

//# sourceMappingURL=stream-ops.web.js.map