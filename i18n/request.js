import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

const supportedLocales = ["vi", "en"];

export default getRequestConfig(async ({ requestLocale }) => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  let locale = supportedLocales.includes(cookieLocale) ? cookieLocale : null;
  if (!locale) {
    const resolvedLocale = await requestLocale;
    locale = supportedLocales.includes(resolvedLocale) ? resolvedLocale : "vi";
  }
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
