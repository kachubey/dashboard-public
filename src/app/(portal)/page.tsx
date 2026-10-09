import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";

export default async function HomePage() {
  const user = await requireUser();
  const t = await getTranslations("home");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {t("greeting", { name: user.name })}
        </h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <ShieldCheckIcon className="mb-2 size-6 text-primary" />
            <CardTitle>{t("vpnCardTitle")}</CardTitle>
            <CardDescription>{t("vpnCardText")}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/vpn" className={buttonVariants()}>
              {t("open")}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
