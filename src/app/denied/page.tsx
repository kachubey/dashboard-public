import { ShieldXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("denied"))("title") };
}

// Better Auth redirects here with ?error=<code>. A session rejected by our
// role gate surfaces as `unable_to_create_session`.
const NO_ROLE_ERRORS = new Set(["unable_to_create_session", "access_denied"]);

export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("denied");
  const { error } = await searchParams;
  const code = typeof error === "string" ? error.slice(0, 64).replace(/[^\w.-]/g, "") : "";
  const noRole = !code || NO_ROLE_ERRORS.has(code);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <ShieldXIcon className="mb-2 size-8 text-destructive" />
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription>{noRole ? t("noRole") : t("failed")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!noRole && <p className="font-mono text-xs text-muted-foreground">{t("errorCode", { code })}</p>}
          <p className="text-sm text-muted-foreground">{t("contact")}</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={env().SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants()}
            >
              {t("support")}
            </a>
            <Link href="/signin" className={buttonVariants({ variant: "outline" })}>
              {t("tryAgain")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
