import { getRequestConfig } from "next-intl/server";

const supportedLocales = ["vi", "en"];

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = supportedLocales.includes(requestLocale) ? requestLocale : "vi";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
