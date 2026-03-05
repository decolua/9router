import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "./config";

const messageLoaders = {
  en: () => import("./messages/en.json"),
  "zh-CN": () => import("./messages/zh-CN.json"),
};

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requestedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = normalizeLocale(requestedLocale || DEFAULT_LOCALE);
  const messages = (await messageLoaders[locale]()).default;

  return {
    locale,
    messages,
  };
});
