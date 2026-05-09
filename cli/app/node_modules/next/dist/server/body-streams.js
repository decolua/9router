"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getCloneableBody: null,
    requestToBodyStream: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getCloneableBody: function() {
        return getCloneableBody;
    },
    requestToBodyStream: function() {
        return requestToBodyStream;
    }
});
const _stream = require("stream");
const _bytes = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/bytes"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const DEFAULT_BODY_CLONE_SIZE_LIMIT = 10 * 1024 * 1024 // 10MB
;
function requestToBodyStream(context, KUint8Array, stream) {
    return new context.ReadableStream({
        start: async (controller)=>{
            for await (const chunk of stream){
                controller.enqueue(new KUint8Array(chunk));
            }
            controller.close();
        }
    });
}
function replaceRequestBody(base, stream) {
    for(const key in stream){
        let v = stream[key];
        if (typeof v === 'function') {
            v = v.bind(base);
        }
        base[key] = v;
    }
    return base;
}
function getCloneableBody(readable, sizeLimit) {
    let buffered = null;
    const endPromise = new Promise((resolve, reject)=>{
        readable.on('end', resolve);
        readable.on('error', reject);
    }).catch((error)=>{
        return {
            error
        };
    });
    return {
        /**
     * Replaces the original request body if necessary.
     * This is done because once we read the body from the original request,
     * we can't read it again.
     */ async finalize () {
            if (buffered) {
                const res = await endPromise;
                if (res && typeof res === 'object' && res.error) {
                    throw res.error;
                }
                replaceRequestBody(readable, buffered);
                buffered = readable;
            }
        },
        /**
     * Clones the body stream
     * to pass into a middleware
     */ cloneBodyStream () {
            const input = buffered ?? readable;
            const p1 = new _stream.PassThrough();
            const p2 = new _stream.PassThrough();
            let bytesRead = 0;
            const bodySizeLimit = sizeLimit ?? DEFAULT_BODY_CLONE_SIZE_LIMIT;
            let limitExceeded = false;
            input.on('data', (chunk)=>{
                if (limitExceeded) return;
                bytesRead += chunk.length;
                if (bytesRead > bodySizeLimit) {
                    limitExceeded = true;
                    const urlInfo = readable.url ? ` for ${readable.url}` : '';
                    console.warn(// TODO(jiwon): Update this document link
                    `Request body exceeded ${_bytes.default.format(bodySizeLimit)}${urlInfo}. Only the first ${_bytes.default.format(bodySizeLimit)} will be available unless configured. See https://nextjs.org/docs/app/api-reference/config/next-config-js/middlewareClientMaxBodySize for more details.`);
                    p1.push(null);
                    p2.push(null);
                    return;
                }
                p1.push(chunk);
                p2.push(chunk);
            });
            input.on('end', ()=>{
                if (!limitExceeded) {
                    p1.push(null);
                    p2.push(null);
                }
            });
            buffered = p2;
            return p1;
        }
    };
}

//# sourceMappingURL=body-streams.js.map