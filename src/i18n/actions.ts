"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import * as z from "zod";
import { getSessionUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { LOCALE_COOKIE, LOCALES } from "./config";

const input = z.enum(LOCALES);

/** Persist the language choice in a cookie and in the user's profile. */
export async function setLocale(locale: string): Promise<void> {
  const value = input.parse(locale);
  (await cookies()).set(LOCALE_COOKIE, value, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: env().isProduction,
    maxAge: 60 * 60 * 24 * 365,
  });
  const user = await getSessionUser();
  if (user) {
    await db.update(schema.user).set({ locale: value }).where(eq(schema.user.id, user.id));
  }
}
