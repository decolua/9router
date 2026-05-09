// Polyfill crypto() in the Node.js environment
"use strict";
if (!global.crypto) {
    let webcrypto;
    Object.defineProperty(global, 'crypto', {
        enumerable: false,
        configurable: true,
        get () {
            if (!webcrypto) {
                // @ts-expect-error -- TODO: Is this actually safe?
                webcrypto = require('node:crypto').webcrypto;
            }
            return webcrypto;
        },
        set (value) {
            webcrypto = value;
        }
    });
}

//# sourceMappingURL=node-polyfill-crypto.js.map