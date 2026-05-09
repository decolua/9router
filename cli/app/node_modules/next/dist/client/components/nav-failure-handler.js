"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    handleHardNavError: null,
    useNavFailureHandler: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    handleHardNavError: function() {
        return handleHardNavError;
    },
    useNavFailureHandler: function() {
        return useNavFailureHandler;
    }
});
const _react = require("react");
const _createhreffromurl = require("./router-reducer/create-href-from-url");
function handleHardNavError(error) {
    if (error && typeof window !== 'undefined' && window.next.__pendingUrl && (0, _createhreffromurl.createHrefFromUrl)(new URL(window.location.href)) !== (0, _createhreffromurl.createHrefFromUrl)(window.next.__pendingUrl)) {
        console.error(`Error occurred during navigation, falling back to hard navigation`, error);
        window.location.href = window.next.__pendingUrl.toString();
        return true;
    }
    return false;
}
function useNavFailureHandler() {
    if (process.env.__NEXT_APP_NAV_FAIL_HANDLING) {
        // this if is only for DCE of the feature flag not conditional
        // eslint-disable-next-line react-hooks/rules-of-hooks
        (0, _react.useEffect)(()=>{
            const uncaughtExceptionHandler = (evt)=>{
                const error = 'reason' in evt ? evt.reason : evt.error;
                // if we have an unhandled exception/rejection during
                // a navigation we fall back to a hard navigation to
                // attempt recovering to a good state
                handleHardNavError(error);
            };
            window.addEventListener('unhandledrejection', uncaughtExceptionHandler);
            window.addEventListener('error', uncaughtExceptionHandler);
            return ()=>{
                window.removeEventListener('error', uncaughtExceptionHandler);
                window.removeEventListener('unhandledrejection', uncaughtExceptionHandler);
            };
        }, []);
    }
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=nav-failure-handler.js.map