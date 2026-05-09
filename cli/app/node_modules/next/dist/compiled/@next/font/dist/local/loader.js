"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-ignore
let fontFromBuffer;
try {
    // eslint-disable-next-line @next/internal/typechecked-require -- Module created during build.
    const mod = require('../fontkit').default;
    fontFromBuffer = mod.default || mod;
}
catch { }
const util_1 = require("util");
const pick_font_file_for_fallback_generation_1 = require("./pick-font-file-for-fallback-generation");
const get_fallback_metrics_from_font_file_1 = require("./get-fallback-metrics-from-font-file");
const validate_local_font_function_call_1 = require("./validate-local-font-function-call");
const nextFontLocalFontLoader = async ({ functionName, variableName, data, emitFontFile, resolve, loaderContext, }) => {
    const { src, display, fallback, preload, variable, adjustFontFallback, declarations, weight: defaultWeight, style: defaultStyle, } = (0, validate_local_font_function_call_1.validateLocalFontFunctionCall)(functionName, data[0]);
    // Load all font files and emit them to the .next output directory
    // Also generate a @font-face CSS for each font file
    const fontFiles = await Promise.all(src.map(async ({ path, style, weight, ext, format }) => {
        const resolved = await resolve(path);
        const fileBuffer = await (0, util_1.promisify)(loaderContext.fs.readFile)(resolved);
        const fontUrl = emitFontFile(fileBuffer, ext, preload, typeof adjustFontFallback === 'undefined' || !!adjustFontFallback);
        // Try to load font metadata from the font file using fontkit.
        // The data is used to calculate the fallback font override values.
        let fontMetadata;
        try {
            fontMetadata = fontFromBuffer === null || fontFromBuffer === void 0 ? void 0 : fontFromBuffer(fileBuffer);
        }
        catch (e) {
            console.error(`Failed to load font file: ${resolved}\n${e}`);
        }
        // Check if `font-family` is explicitly defined in `declarations`
        const hasCustomFontFamily = declarations === null || declarations === void 0 ? void 0 : declarations.some(({ prop }) => prop === 'font-family');
        // Get all values that should be added to the @font-face declaration
        const fontFaceProperties = [
            ...(declarations
                ? declarations.map(({ prop, value }) => [prop, value])
                : []),
            ...(hasCustomFontFamily ? [] : [['font-family', variableName]]),
            ['src', `url(${fontUrl}) format('${format}')`],
            ['font-display', display],
            ...((weight !== null && weight !== void 0 ? weight : defaultWeight)
                ? [['font-weight', weight !== null && weight !== void 0 ? weight : defaultWeight]]
                : []),
            ...((style !== null && style !== void 0 ? style : defaultStyle)
                ? [['font-style', style !== null && style !== void 0 ? style : defaultStyle]]
                : []),
        ];
        // Generate the @font-face CSS from the font-face properties
        const css = `@font-face {\n${fontFaceProperties
            .map(([property, value]) => `${property}: ${value};`)
            .join('\n')}\n}\n`;
        return {
            css,
            fontMetadata,
            weight,
            style,
        };
    }));
    // Calculate the fallback font override values using the font file metadata
    let adjustFontFallbackMetrics;
    if (adjustFontFallback !== false) {
        const fallbackFontFile = (0, pick_font_file_for_fallback_generation_1.pickFontFileForFallbackGeneration)(fontFiles);
        if (fallbackFontFile.fontMetadata) {
            adjustFontFallbackMetrics = (0, get_fallback_metrics_from_font_file_1.getFallbackMetricsFromFontFile)(fallbackFontFile.fontMetadata, adjustFontFallback === 'Times New Roman' ? 'serif' : 'sans-serif');
        }
    }
    return {
        css: fontFiles.map(({ css }) => css).join('\n'),
        fallbackFonts: fallback,
        weight: src.length === 1 ? src[0].weight : undefined,
        style: src.length === 1 ? src[0].style : undefined,
        variable,
        adjustFontFallback: adjustFontFallbackMetrics,
    };
};
exports.default = nextFontLocalFontLoader;
