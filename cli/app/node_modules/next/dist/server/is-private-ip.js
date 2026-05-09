"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "isPrivateIp", {
    enumerable: true,
    get: function() {
        return isPrivateIp;
    }
});
const _ipaddr = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/ipaddr.js"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function isPrivateIp(ip) {
    if (ip.startsWith('[') && ip.endsWith(']')) {
        ip = ip.slice(1, -1);
    }
    if (!_ipaddr.default.isValid(ip)) {
        return false;
    }
    try {
        let addr = _ipaddr.default.parse(ip);
        if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
            addr = addr.toIPv4Address();
        }
        const range = addr.range();
        return range !== 'unicast';
    } catch (e) {
        return false;
    }
}

//# sourceMappingURL=is-private-ip.js.map