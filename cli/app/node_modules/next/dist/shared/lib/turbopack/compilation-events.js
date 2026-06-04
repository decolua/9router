"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    backgroundLogCompilationEvents: null,
    msToNs: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    backgroundLogCompilationEvents: function() {
        return backgroundLogCompilationEvents;
    },
    msToNs: function() {
        return msToNs;
    }
});
const _interop_require_wildcard = require("@swc/helpers/_/_interop_require_wildcard");
const _log = /*#__PURE__*/ _interop_require_wildcard._(require("../../../build/output/log"));
const _trace = require("../../../trace");
const _trace1 = require("../../../lib/memory/trace");
const MILLISECONDS_IN_NANOSECOND = BigInt(1000000);
function msToNs(ms) {
    return BigInt(Math.floor(ms)) * MILLISECONDS_IN_NANOSECOND;
}
function backgroundLogCompilationEvents(project, { eventTypes, signal, parentSpan } = {}) {
    const iterator = project.compilationEventsSubscribe(eventTypes);
    // Close the iterator as soon as the signal fires so the for-await loop
    // exits without waiting for the next compilation event.
    signal?.addEventListener('abort', ()=>iterator.return?.(undefined), {
        once: true
    });
    const promise = async function() {
        for await (const event of iterator){
            // Record TraceEvent compilation events as trace spans in .next/trace.
            if (parentSpan && event.typeName === 'TraceEvent' && event.eventJson) {
                try {
                    const data = JSON.parse(event.eventJson);
                    parentSpan.manualTraceChild(data.name, msToNs(data.startTimeMs), msToNs(data.endTimeMs), Object.fromEntries(data.attributes ?? []));
                    (0, _trace1.traceMemoryUsage)(data.name, parentSpan);
                    // We flush after each event to make sure it makes it to disk.  These events are rare and
                    // tend to happen at the very end of a build so to make sure they are logged we need to
                    // flush.
                    // NOTE: in a `next build` environment where we are reporting events to the parent thread, this is a no-op.
                    await (0, _trace.flushAllTraces)();
                } catch  {}
                continue; // don't log these events, they just go to the trace file
            }
            switch(event.severity){
                case 'EVENT':
                    _log.event(event.message);
                    break;
                case 'TRACE':
                    _log.trace(event.message);
                    break;
                case 'INFO':
                    _log.info(event.message);
                    break;
                case 'WARNING':
                    _log.warn(event.message);
                    break;
                case 'ERROR':
                    _log.error(event.message);
                    break;
                case 'FATAL':
                    _log.error(event.message);
                    break;
                default:
                    break;
            }
        }
    }();
    // Prevent unhandled rejection if the subscription errors after the project shuts down.
    promise.catch(()=>{});
    return promise;
}

//# sourceMappingURL=compilation-events.js.map