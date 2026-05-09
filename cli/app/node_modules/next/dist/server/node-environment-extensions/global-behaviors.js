/**
 * Unlike most files in the node-environment-extensions folder this one is not
 * an extension itself but it exposes a function to install config based global
 * behaviors that should be loaded whenever a Node Server or Node Worker are created.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "installGlobalBehaviors", {
    enumerable: true,
    get: function() {
        return installGlobalBehaviors;
    }
});
const _invarianterror = require("../../shared/lib/invariant-error");
const _consoledimexternal = require("./console-dim.external");
function installGlobalBehaviors(config) {
    var _config_experimental;
    if (process.env.NEXT_RUNTIME === 'edge') {
        throw Object.defineProperty(new _invarianterror.InvariantError('Expected not to install Node.js global behaviors in the edge runtime.'), "__NEXT_ERROR_CODE", {
            value: "E874",
            enumerable: false,
            configurable: true
        });
    }
    if (((_config_experimental = config.experimental) == null ? void 0 : _config_experimental.hideLogsAfterAbort) === true) {
        (0, _consoledimexternal.setAbortedLogsStyle)('hidden');
    } else {
        (0, _consoledimexternal.setAbortedLogsStyle)('dimmed');
    }
}

//# sourceMappingURL=global-behaviors.js.map