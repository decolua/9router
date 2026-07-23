"use client";

import { useEffect, useState } from "react";
import { getCurrentLocale, onLocaleChange, translate } from "./runtime";

export function useRuntimeTranslation() {
  const [locale, setLocale] = useState(() => getCurrentLocale());
  useEffect(() => onLocaleChange(() => setLocale(getCurrentLocale())), []);
  return { locale, t: translate };
}
