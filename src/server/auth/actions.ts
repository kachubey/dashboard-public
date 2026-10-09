"use server";

import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import { APIError } from "better-auth/api";
import { getAuth } from ".";
import { audit, requestMeta } from "../audit";
import { env } from "../env";
import { getSessionUser } from "./session";

export async function signInWithMicrosoft(): Promise<void> {
  if (!env().entraEnabled) redirect("/signin");
  let url: string | undefined;
  try {
    ({ url } = await getAuth().api.signInSocial({
      body: {
        provider: "microsoft",
        callbackURL: "/",
        errorCallbackURL: "/denied",
        // Show the Microsoft sign-in page in the portal's current language.
        additionalParams: { ui_locales: await getLocale() },
        disableRedirect: true,
      },
      headers: await headers(),
    }));
  } catch (error) {
    if (error instanceof APIError && error.status === "TOO_MANY_REQUESTS") redirect("/signin?error=rate_limited");
    throw error;
  }
  if (!url) redirect("/denied?error=no_redirect");
  redirect(url);
}

const mockInput = z.object({ oid: z.uuid() });

export async function signInAsMockUser(formData: FormData): Promise<void> {
  if (!env().authMockEnabled) redirect("/signin");
  const { oid } = mockInput.parse({ oid: formData.get("oid") });
  // Endpoint added by the mock-sign-in plugin; nextCookies() applies the cookie.
  const api = getAuth().api as unknown as {
    mockSignIn(args: { body: { oid: string }; headers: Headers }): Promise<{ ok: boolean }>;
  };
  const result = await api.mockSignIn({ body: { oid }, headers: await headers() });
  redirect(result.ok ? "/" : "/denied?error=unable_to_create_session");
}

export async function signOut(): Promise<void> {
  const h = await headers();
  const user = await getSessionUser();
  await getAuth().api.signOut({ headers: h });
  if (user) {
    await audit({
      actor: { oid: user.oid, upn: user.upn },
      action: "sign_out",
      meta: requestMeta(h),
    });
  }
  redirect("/signin");
}
