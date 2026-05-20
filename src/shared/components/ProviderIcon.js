"use client";

import { useState } from "react";
import PropTypes from "prop-types";

// Returns true if color is too light/transparent to be readable on white bg
function isLightColor(hex) {
  if (!hex) return true;
  const clean = hex.replace("#", "");
  // Handle 8-char hex (with alpha) — if alpha is very low, treat as light
  if (clean.length === 8) {
    const alpha = parseInt(clean.slice(6, 8), 16) / 255;
    if (alpha < 0.3) return true;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return true;
  // Perceived luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.7;
}

export default function ProviderIcon({
  src,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
}) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    const textColor = isLightColor(fallbackColor) ? "#1a1a1a" : (fallbackColor || "#1a1a1a");
    return (
      <span
        className={`inline-flex items-center justify-center font-bold rounded-lg bg-white ${className}`.trim()}
        style={{
          width: size,
          height: size,
          color: textColor,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`bg-white rounded-lg ${className}`.trim()}
      onError={() => setErrored(true)}
    />
  );
}

ProviderIcon.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  size: PropTypes.number,
  className: PropTypes.string,
  fallbackText: PropTypes.string,
  fallbackColor: PropTypes.string,
};
