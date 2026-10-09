import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminOverview } from "@/server/admin/stats";
import { requireAdmin } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin"))("title") };
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const t = await getTranslations("admin.overview");
  const s = await adminOverview();
  const tiles = [
    { label: t("active"), value: s.active, href: "/admin/configs?status=active" },
    { label: t("pending"), value: s.pending, hint: t("pendingHint"), href: "/admin/users#unlinked", warn: s.pending > 0 },
    { label: t("notDownloaded"), value: s.not_downloaded, hint: t("notDownloadedHint"), href: "/admin/configs?status=not_downloaded" },
    { label: t("quarantine"), value: s.quarantine, hint: t("quarantineHint"), href: "/admin/quarantine", warn: s.quarantine > 0 },
    { label: t("users"), value: s.users, href: "/admin/users" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Card size="sm" className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardDescription>{tile.label}</CardDescription>
                <CardTitle className={`text-3xl tabular-nums ${tile.warn ? "text-amber-500" : ""}`}>{tile.value}</CardTitle>
                {tile.hint && <p className="text-xs text-muted-foreground">{tile.hint}</p>}
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
