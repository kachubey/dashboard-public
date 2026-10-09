import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { env } from "@/server/env";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, matchAcceptLanguage } from "./config";

// Locale is not part of the URL: links are shared between colleagues who read
// different languages. Resolution order:
//   1. explicit choice (cookie; set by the switcher and restored from the
//      user's profile on sign-in, so it follows them across devices)
//   2. browser Accept-Language
//   3. English
export default getRequestConfig(async () => {
  const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieValue)
    ? cookieValue
    : (matchAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: env().APP_TIME_ZONE,
  };
});
