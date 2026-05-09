"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "dynamicParamTypes", {
    enumerable: true,
    get: function() {
        return dynamicParamTypes;
    }
});
const dynamicParamTypes = {
    catchall: 'c',
    'catchall-intercepted-(..)(..)': 'ci(..)(..)',
    'catchall-intercepted-(.)': 'ci(.)',
    'catchall-intercepted-(..)': 'ci(..)',
    'catchall-intercepted-(...)': 'ci(...)',
    'optional-catchall': 'oc',
    dynamic: 'd',
    'dynamic-intercepted-(..)(..)': 'di(..)(..)',
    'dynamic-intercepted-(.)': 'di(.)',
    'dynamic-intercepted-(..)': 'di(..)',
    'dynamic-intercepted-(...)': 'di(...)'
};

//# sourceMappingURL=get-short-dynamic-param-type.js.map