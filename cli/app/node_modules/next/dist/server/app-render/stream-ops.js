/**
 * Compile-time switcher for stream operations.
 *
 * PR2: Simple re-export from the web implementation.
 * A future change will add a conditional branch for node streams.
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
        return _streamopsweb.chainStreams;
    },
    continueDynamicHTMLResume: function() {
        return _streamopsweb.continueDynamicHTMLResume;
    },
    continueDynamicPrerender: function() {
        return _streamopsweb.continueDynamicPrerender;
    },
    continueFizzStream: function() {
        return _streamopsweb.continueFizzStream;
    },
    continueStaticFallbackPrerender: function() {
        return _streamopsweb.continueStaticFallbackPrerender;
    },
    continueStaticPrerender: function() {
        return _streamopsweb.continueStaticPrerender;
    },
    createDocumentClosingStream: function() {
        return _streamopsweb.createDocumentClosingStream;
    },
    createInlinedDataStream: function() {
        return _streamopsweb.createInlinedDataStream;
    },
    createOnHeadersCallback: function() {
        return _streamopsweb.createOnHeadersCallback;
    },
    createPendingStream: function() {
        return _streamopsweb.createPendingStream;
    },
    getClientPrerender: function() {
        return _streamopsweb.getClientPrerender;
    },
    getServerPrerender: function() {
        return _streamopsweb.getServerPrerender;
    },
    nodeReadableToWeb: function() {
        return _streamopsweb.nodeReadableToWeb;
    },
    pipeRuntimePrefetchTransform: function() {
        return _streamopsweb.pipeRuntimePrefetchTransform;
    },
    processPrelude: function() {
        return _streamopsweb.processPrelude;
    },
    renderToFizzStream: function() {
        return _streamopsweb.renderToFizzStream;
    },
    renderToFlightStream: function() {
        return _streamopsweb.renderToFlightStream;
    },
    resumeAndAbort: function() {
        return _streamopsweb.resumeAndAbort;
    },
    resumeToFizzStream: function() {
        return _streamopsweb.resumeToFizzStream;
    },
    streamToBuffer: function() {
        return _streamopsweb.streamToBuffer;
    },
    streamToString: function() {
        return _streamopsweb.streamToString;
    }
});
const _streamopsweb = require("./stream-ops.web");

//# sourceMappingURL=stream-ops.js.map