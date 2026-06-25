"use client";

import { useState } from "react";
import PropTypes from "prop-types";

const CUSTOM_PROVIDER_ICON_RE = /^\/providers\/.+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;
const PROVIDER_ICON_OVERRIDES = {
  "/providers/kimi-api.png": "/providers/kimi.png",
};

export default function ProviderIcon({
  src,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
}) {
  const [errored, setErrored] = useState(false);
  const iconSrc = PROVIDER_ICON_OVERRIDES[src] || src;
  const useFallback = !iconSrc || errored || CUSTOM_PROVIDER_ICON_RE.test(iconSrc);

  if (useFallback) {
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
      src={iconSrc}
      alt={alt}
      width={size}
      height={size}
      className={className}
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
