"use client";

import { useEffect, useReducer } from "react";
import { onLocaleChange, translate } from "./runtime";

export function useTranslation() {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => onLocaleChange(refresh), []);
  return translate;
}
