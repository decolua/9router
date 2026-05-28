"use client";

import { useEffect, useState } from "react";

export function useEndpointBaseUrl() {
  const [baseUrl, setBaseUrl] = useState("/v1");

  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  return baseUrl;
}
