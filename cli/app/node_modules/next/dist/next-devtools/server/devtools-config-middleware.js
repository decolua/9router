"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    devToolsConfigMiddleware: null,
    getDevToolsConfig: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    devToolsConfigMiddleware: function() {
        return devToolsConfigMiddleware;
    },
    getDevToolsConfig: function() {
        return getDevToolsConfig;
    }
});
const _fs = require("fs");
const _promises = require("fs/promises");
const _path = require("path");
const _middlewareresponse = require("./middleware-response");
const _devtoolsconfigschema = require("../shared/devtools-config-schema");
const _deepmerge = require("../shared/deepmerge");
const DEVTOOLS_CONFIG_FILENAME = 'next-devtools-config.json';
const DEVTOOLS_CONFIG_MIDDLEWARE_ENDPOINT = '/__nextjs_devtools_config';
function devToolsConfigMiddleware({ distDir, sendUpdateSignal }) {
    const configPath = (0, _path.join)(distDir, 'cache', DEVTOOLS_CONFIG_FILENAME);
    return async function devToolsConfigMiddlewareHandler(req, res, next) {
        const { pathname } = new URL(`http://n${req.url}`);
        if (pathname !== DEVTOOLS_CONFIG_MIDDLEWARE_ENDPOINT) {
            return next();
        }
        if (req.method !== 'POST') {
            return _middlewareresponse.middlewareResponse.methodNotAllowed(res);
        }
        const currentConfig = await getDevToolsConfig(distDir);
        const chunks = [];
        for await (const chunk of req){
            chunks.push(Buffer.from(chunk));
        }
        let body = Buffer.concat(chunks).toString('utf8');
        try {
            body = JSON.parse(body);
        } catch (error) {
            console.error('[Next.js DevTools] Invalid config body passed:', error);
            return _middlewareresponse.middlewareResponse.badRequest(res);
        }
        const validation = _devtoolsconfigschema.devToolsConfigSchema.safeParse(body);
        if (!validation.success) {
            console.error('[Next.js DevTools] Invalid config passed:', validation.error.message);
            return _middlewareresponse.middlewareResponse.badRequest(res);
        }
        const newConfig = (0, _deepmerge.deepMerge)(currentConfig, validation.data);
        await (0, _promises.writeFile)(configPath, JSON.stringify(newConfig, null, 2));
        sendUpdateSignal(newConfig);
        return _middlewareresponse.middlewareResponse.noContent(res);
    };
}
async function getDevToolsConfig(distDir) {
    const configPath = (0, _path.join)(distDir, 'cache', DEVTOOLS_CONFIG_FILENAME);
    if (!(0, _fs.existsSync)(configPath)) {
        await (0, _promises.mkdir)((0, _path.dirname)(configPath), {
            recursive: true
        });
        await (0, _promises.writeFile)(configPath, JSON.stringify({}));
        return {};
    }
    return JSON.parse(await (0, _promises.readFile)(configPath, 'utf8'));
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=devtools-config-middleware.js.map