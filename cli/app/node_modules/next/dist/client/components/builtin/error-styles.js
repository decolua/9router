"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    WarningIcon: null,
    errorStyles: null,
    errorThemeCss: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    WarningIcon: function() {
        return WarningIcon;
    },
    errorStyles: function() {
        return errorStyles;
    },
    errorThemeCss: function() {
        return errorThemeCss;
    }
});
const _interop_require_default = require("@swc/helpers/_/_interop_require_default");
const _jsxruntime = require("react/jsx-runtime");
const _react = /*#__PURE__*/ _interop_require_default._(require("react"));
const errorStyles = {
    container: {
        fontFamily: 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    },
    card: {
        marginTop: '-32px',
        maxWidth: '325px',
        padding: '32px 28px',
        textAlign: 'left'
    },
    icon: {
        marginBottom: '24px'
    },
    title: {
        fontSize: '24px',
        fontWeight: 500,
        letterSpacing: '-0.02em',
        lineHeight: '32px',
        margin: '0 0 12px 0',
        color: 'var(--next-error-title)'
    },
    message: {
        fontSize: '14px',
        fontWeight: 400,
        lineHeight: '21px',
        margin: '0 0 20px 0',
        color: 'var(--next-error-message)'
    },
    form: {
        margin: 0
    },
    buttonGroup: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
    },
    button: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '32px',
        padding: '0 12px',
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '20px',
        borderRadius: '6px',
        cursor: 'pointer',
        color: 'var(--next-error-btn-text)',
        background: 'var(--next-error-btn-bg)',
        border: 'var(--next-error-btn-border)'
    },
    buttonSecondary: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '32px',
        padding: '0 12px',
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '20px',
        borderRadius: '6px',
        cursor: 'pointer',
        color: 'var(--next-error-btn-secondary-text)',
        background: 'var(--next-error-btn-secondary-bg)',
        border: 'var(--next-error-btn-secondary-border)'
    },
    digestFooter: {
        position: 'fixed',
        bottom: '32px',
        left: '0',
        right: '0',
        textAlign: 'center',
        fontFamily: 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace',
        fontSize: '12px',
        lineHeight: '18px',
        fontWeight: 400,
        margin: '0',
        color: 'var(--next-error-digest)'
    }
};
const errorThemeCss = `
:root {
  --next-error-bg: #fff;
  --next-error-text: #171717;
  --next-error-title: #171717;
  --next-error-message: #171717;
  --next-error-digest: #666666;
  --next-error-btn-text: #fff;
  --next-error-btn-bg: #171717;
  --next-error-btn-border: none;
  --next-error-btn-secondary-text: #171717;
  --next-error-btn-secondary-bg: transparent;
  --next-error-btn-secondary-border: 1px solid rgba(0,0,0,0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --next-error-bg: #0a0a0a;
    --next-error-text: #ededed;
    --next-error-title: #ededed;
    --next-error-message: #ededed;
    --next-error-digest: #a0a0a0;
    --next-error-btn-text: #0a0a0a;
    --next-error-btn-bg: #ededed;
    --next-error-btn-border: none;
    --next-error-btn-secondary-text: #ededed;
    --next-error-btn-secondary-bg: transparent;
    --next-error-btn-secondary-border: 1px solid rgba(255,255,255,0.14);
  }
}
body { margin: 0; color: var(--next-error-text); background: var(--next-error-bg); }
`.replace(/\n\s*/g, '');
function WarningIcon() {
    return /*#__PURE__*/ (0, _jsxruntime.jsx)("svg", {
        width: "32",
        height: "32",
        viewBox: "-0.2 -1.5 32 32",
        fill: "none",
        style: errorStyles.icon,
        children: /*#__PURE__*/ (0, _jsxruntime.jsx)("path", {
            d: "M16.9328 0C18.0839 0.000116771 19.1334 0.658832 19.634 1.69531L31.4299 26.1309C32.0708 27.4588 31.1036 28.9999 29.6291 29H2.00215C0.527541 29 -0.439628 27.4588 0.201371 26.1309L11.9973 1.69531C12.4979 0.658823 13.5474 7.75066e-05 14.6984 0H16.9328ZM3.59493 26H28.0363L16.9328 3H14.6984L3.59493 26ZM15.8156 19C16.9202 19.0001 17.8156 19.8955 17.8156 21C17.8156 22.1045 16.9202 22.9999 15.8156 23C14.7111 23 13.8156 22.1046 13.8156 21C13.8156 19.8954 14.7111 19 15.8156 19ZM17.3156 16.5H14.3156V8.5H17.3156V16.5Z",
            fill: "var(--next-error-title)"
        })
    });
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=error-styles.js.map