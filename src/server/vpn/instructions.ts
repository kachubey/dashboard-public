import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { getConfigType } from "./types";

// "How to connect" texts live in content/instructions/<locale>/<type>.md so
// they can be edited without touching code. Read on every request: after
// editing, a page reload shows the new text (in production, mount the folder
// as a volume or rebuild the image).

const ROOT = path.join(process.cwd(), "content", "instructions");

async function read(locale: string, type: string): Promise<string | null> {
  try {
    return await readFile(path.join(ROOT, locale, `${type}.md`), "utf8");
  } catch {
    return null;
  }
}

export async function loadInstructions(
  type: string,
  locale: string,
): Promise<{ markdown: string; fallback: boolean } | null> {
  // Both parts come from fixed lists, never from the request, so no path tricks.
  if (!getConfigType(type) || !isLocale(locale)) return null;
  const own = await read(locale, type);
  if (own) return { markdown: own, fallback: false };
  const en = locale === DEFAULT_LOCALE ? null : await read(DEFAULT_LOCALE, type);
  return en ? { markdown: en, fallback: true } : null;
}
