import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { clientMessages } from "@/i18n/client-messages";
import { AdminNav } from "@/components/admin/admin-nav";
import { adminOverview } from "@/server/admin/stats";
import { requireAdmin } from "@/server/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  const t = await getTranslations("admin");
  const stats = await adminOverview();
  return (
    <NextIntlClientProvider messages={await clientMessages(["admin"])}>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <AdminNav counts={{ quarantine: stats.quarantine, pending: stats.pending }} />
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
