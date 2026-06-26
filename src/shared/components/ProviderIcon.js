"use client";

import { useState, useCallback } from "react";
import PropTypes from "prop-types";

function tryExtensions(basePath, extensions, index = 0) {
  if (!extensions || index >= extensions.length) return null;
  return `${basePath}.${extensions[index]}`;
}

export default function ProviderIcon({
  src,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
  providerId,
}) {
  const [currentSrc, setCurrentSrc] = useState(() => {
    if (src) return src;
    if (providerId) return tryExtensions(`/providers/${providerId}`, ["svg", "png"]);
    return null;
  });
  const [errored, setErrored] = useState(false);

  const handleError = useCallback(() => {
    if (providerId && currentSrc) {
      // Try next extension
      const exts = ["svg", "png"];
      const currentExt = currentSrc.split(".").pop();
      const nextIdx = exts.indexOf(currentExt) + 1;
      if (nextIdx < exts.length) {
        setCurrentSrc(`/providers/${providerId}.${exts[nextIdx]}`);
        return;
      }
    }
    setErrored(true);
  }, [providerId, currentSrc]);

  if (!currentSrc || errored) {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold rounded-lg ${className}`.trim()}
        style={{
          width: size,
          height: size,
          color: fallbackColor,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      width={size}
      height={size}
      className={className}
      onError={handleError}
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
  providerId: PropTypes.string,
};
