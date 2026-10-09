import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { signInAsMockUser, signInWithMicrosoft } from "@/server/auth/actions";
import { MOCK_USERS } from "@/server/auth/mock-users";
import { getSessionUser } from "@/server/auth/session";
import { env } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signin"))("title") };
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" className="size-4">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const t = await getTranslations();
  const { entraEnabled, authMockEnabled } = env();
  const limited = (await searchParams).error === "rate_limited";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("app.name")}</CardTitle>
          <CardDescription>{t(authMockEnabled && !entraEnabled ? "signin.demoSubtitle" : "signin.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {limited && <p role="alert" className="text-sm text-destructive">{t("signin.rateLimited")}</p>}
          {entraEnabled ? (
            <form action={signInWithMicrosoft}>
              <Button type="submit" size="lg" className="w-full">
                <MicrosoftLogo />
                {t("signin.withMicrosoft")}
              </Button>
            </form>
          ) : !authMockEnabled ? (
            <p className="text-sm text-muted-foreground">{t("signin.notConfigured")}</p>
          ) : null}

          {authMockEnabled && (
            <div className="flex flex-col gap-3">
              {entraEnabled && <Separator />}
              <div>
                <p className="text-sm font-medium">{t("signin.mockTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("signin.mockHint")}</p>
              </div>
              {MOCK_USERS.map((u) => (
                <form key={u.oid} action={signInAsMockUser}>
                  <input type="hidden" name="oid" value={u.oid} />
                  <Button type="submit" variant="outline" className="h-auto w-full justify-between py-2">
                    <span className="flex flex-col items-start">
                      <span>{u.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">{u.upn}</span>
                    </span>
                    <Badge variant={u.roles.length ? "secondary" : "destructive"}>
                      {u.roles.length
                        ? u.roles.map((r) => r.replace("Portal.", "")).join(", ")
                        : t("signin.mockNoRole")}
                    </Badge>
                  </Button>
                </form>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
