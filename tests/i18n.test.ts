import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import ru from "../messages/ru.json";
import { matchAcceptLanguage } from "@/i18n/config";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("en and ru have exactly the same message keys", () => {
    expect(keys(ru).sort()).toEqual(keys(en).sort());
  });

  it("no message is empty", () => {
    for (const [name, catalogue] of Object.entries({ en, ru })) {
      const empty = keys(catalogue).filter((k) => {
        const value = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], catalogue);
        return typeof value !== "string" || value.trim() === "";
      });
      expect(empty, name).toEqual([]);
    }
  });

  it("matches Accept-Language by quality", () => {
    expect(matchAcceptLanguage("ru-RU,ru;q=0.9,en-US;q=0.8")).toBe("ru");
    expect(matchAcceptLanguage("de-DE,de;q=0.9,en;q=0.5,ru;q=0.4")).toBe("en");
    expect(matchAcceptLanguage("fr-FR")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});
