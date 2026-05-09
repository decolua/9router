/** Monitor when the consumer finishes reading the response body.
that's as close as we can get to `res.on('close')` using web APIs.
*/ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    CloseController: null,
    trackBodyConsumed: null,
    trackStreamConsumed: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    CloseController: function() {
        return CloseController;
    },
    trackBodyConsumed: function() {
        return trackBodyConsumed;
    },
    trackStreamConsumed: function() {
        return trackStreamConsumed;
    }
});
function trackBodyConsumed(body, onEnd) {
    if (typeof body === 'string') {
        const generator = async function* generate() {
            const encoder = new TextEncoder();
            yield encoder.encode(body);
            onEnd();
        };
        // @ts-expect-error BodyInit typings doesn't seem to include AsyncIterables even though it's supported in practice
        return generator();
    } else {
        return trackStreamConsumed(body, onEnd);
    }
}
function trackStreamConsumed(stream, onEnd) {
    // NOTE: This function must handle `stream` being aborted or cancelled,
    // so it can't just be this:
    //
    //   return stream.pipeThrough(new TransformStream({ flush() { onEnd() } }))
    //
    // because that doesn't handle cancellations.
    // (and cancellation handling via `Transformer.cancel` is only available in node >20)
    const dest = new TransformStream();
    const runOnEnd = ()=>onEnd();
    stream.pipeTo(dest.writable).then(runOnEnd, runOnEnd);
    return dest.readable;
}
class CloseController {
    onClose(callback) {
        if (this.isClosed) {
            throw Object.defineProperty(new Error('Cannot subscribe to a closed CloseController'), "__NEXT_ERROR_CODE", {
                value: "E365",
                enumerable: false,
                configurable: true
            });
        }
        this.target.addEventListener('close', callback);
        this.listeners++;
    }
    dispatchClose() {
        if (this.isClosed) {
            throw Object.defineProperty(new Error('Cannot close a CloseController multiple times'), "__NEXT_ERROR_CODE", {
                value: "E229",
                enumerable: false,
                configurable: true
            });
        }
        if (this.listeners > 0) {
            this.target.dispatchEvent(new Event('close'));
        }
        this.isClosed = true;
    }
    constructor(){
        this.target = new EventTarget();
        this.listeners = 0;
        this.isClosed = false;
    }
}

//# sourceMappingURL=web-on-close.js.map