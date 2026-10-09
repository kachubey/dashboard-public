import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ImportUploader } from "@/components/admin/import-uploader";
import { requireAdmin } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin.nav"))("import") };
}

export default async function AdminImportPage() {
  await requireAdmin();
  const t = await getTranslations("admin.import");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <ImportUploader />
    </div>
  );
}
