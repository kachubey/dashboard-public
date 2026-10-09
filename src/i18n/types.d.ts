import type messages from "../../messages/en.json";
import type { Locale } from "./config";

// English is the reference catalogue: a key missing from en.json is a type
// error; tests/i18n.test.ts checks that ru.json has exactly the same keys.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
