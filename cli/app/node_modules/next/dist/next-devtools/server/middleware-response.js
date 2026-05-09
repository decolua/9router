"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "middlewareResponse", {
    enumerable: true,
    get: function() {
        return middlewareResponse;
    }
});
const _util = require("util");
const middlewareResponse = {
    noContent (res) {
        res.statusCode = 204;
        res.end('No Content');
    },
    badRequest (res, reason) {
        res.statusCode = 400;
        if (reason !== undefined) {
            res.setHeader('Content-Type', 'text/plain');
            res.end(reason);
        } else {
            res.end();
        }
    },
    notFound (res) {
        res.statusCode = 404;
        res.end('Not Found');
    },
    methodNotAllowed (res) {
        res.statusCode = 405;
        res.end('Method Not Allowed');
    },
    internalServerError (res, error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end(error !== undefined ? (0, _util.inspect)(error, {
            colors: false
        }) : 'Internal Server Error');
    },
    json (res, data) {
        res.setHeader('Content-Type', 'application/json').end(Buffer.from(JSON.stringify(data)));
    },
    jsonString (res, data) {
        res.setHeader('Content-Type', 'application/json').end(Buffer.from(data));
    }
};

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=middleware-response.js.map