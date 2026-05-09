"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const runtime_1 = __importDefault(require("next/dist/compiled/react-refresh/runtime"));
if (typeof self !== 'undefined') {
    var $RefreshInjected$ = '__reactRefreshInjected';
    // Only inject the runtime if it hasn't been injected
    if (!self[$RefreshInjected$]) {
        runtime_1.default.injectIntoGlobalHook(self);
        // Empty implementation to avoid "ReferenceError: variable is not defined" in module which didn't pass builtin:react-refresh-loader
        self.$RefreshSig$ = () => (type) => type;
        self.$RefreshReg$ = () => { };
        // Mark the runtime as injected to prevent double-injection
        self[$RefreshInjected$] = true;
    }
}
//# sourceMappingURL=rspack-runtime.js.map