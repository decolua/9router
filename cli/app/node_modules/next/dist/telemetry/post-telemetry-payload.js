"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "postNextTelemetryPayload", {
    enumerable: true,
    get: function() {
        return postNextTelemetryPayload;
    }
});
const _asyncretry = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/async-retry"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function postNextTelemetryPayload(payload, signal) {
    if (!signal && 'timeout' in AbortSignal) {
        signal = AbortSignal.timeout(5000);
    }
    return (0, _asyncretry.default)(()=>fetch('https://telemetry.nextjs.org/api/v1/record', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
                'content-type': 'application/json'
            },
            signal
        }).then((res)=>{
            if (!res.ok) {
                const err = Object.defineProperty(new Error(res.statusText), "__NEXT_ERROR_CODE", {
                    value: "E394",
                    enumerable: false,
                    configurable: true
                });
                err.response = res;
                throw err;
            }
        }), {
        minTimeout: 500,
        retries: 1,
        factor: 1
    }).catch(()=>{
    // We swallow errors when telemetry cannot be sent
    })// Ensure promise is voided
    .then(()=>{}, ()=>{});
}

//# sourceMappingURL=post-telemetry-payload.js.map