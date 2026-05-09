"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    isNodeNextRequest: null,
    isNodeNextResponse: null,
    isWebNextRequest: null,
    isWebNextResponse: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    isNodeNextRequest: function() {
        return isNodeNextRequest;
    },
    isNodeNextResponse: function() {
        return isNodeNextResponse;
    },
    isWebNextRequest: function() {
        return isWebNextRequest;
    },
    isWebNextResponse: function() {
        return isWebNextResponse;
    }
});
const isWebNextRequest = (req)=>process.env.NEXT_RUNTIME === 'edge';
const isWebNextResponse = (res)=>process.env.NEXT_RUNTIME === 'edge';
const isNodeNextRequest = (req)=>process.env.NEXT_RUNTIME !== 'edge';
const isNodeNextResponse = (res)=>process.env.NEXT_RUNTIME !== 'edge';

//# sourceMappingURL=helpers.js.map