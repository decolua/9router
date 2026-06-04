/**
 * We extend Web Crypto APIs during builds and revalidates to ensure that prerenders don't observe random bytes
 * When cacheComponents is enabled. Random bytes are a form of IO even if they resolve synchronously. When cacheComponents is
 * enabled we need to ensure that random bytes are excluded from prerenders unless they are cached.
 *
 *
 * The extensions here never error nor alter the underlying return values and thus should be transparent to callers.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _ioutils = require("./io-utils");
let webCrypto;
if (process.env.NEXT_RUNTIME === 'edge') {
    webCrypto = crypto;
} else {
    if (typeof crypto === 'undefined') {
        // @ts-expect-error -- TODO: Is this actually safe?
        webCrypto = require('node:crypto').webcrypto;
    } else {
        webCrypto = crypto;
    }
}
const getRandomValuesExpression = '`crypto.getRandomValues()`';
try {
    const _getRandomValues = webCrypto.getRandomValues;
    webCrypto.getRandomValues = function getRandomValues() {
        (0, _ioutils.io)(getRandomValuesExpression, 'crypto');
        return _getRandomValues.apply(webCrypto, arguments);
    };
} catch  {
    console.error(`Failed to install ${getRandomValuesExpression} extension. When using \`cacheComponents\` calling this function will not correctly trigger dynamic behavior.`);
}
const randomUUIDExpression = '`crypto.randomUUID()`';
try {
    const _randomUUID = webCrypto.randomUUID;
    webCrypto.randomUUID = function randomUUID() {
        (0, _ioutils.io)(randomUUIDExpression, 'crypto');
        return _randomUUID.apply(webCrypto, arguments);
    };
} catch  {
    console.error(`Failed to install ${getRandomValuesExpression} extension. When using \`cacheComponents\` calling this function will not correctly trigger dynamic behavior.`);
}

//# sourceMappingURL=web-crypto.js.map