import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        {t("back")}
      </Link>
    </main>
  );
}
