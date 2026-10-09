import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { PAGE_SIZE } from "@/server/admin/shared";

/** Previous/next links that keep the current filters. */
export async function Pagination({
  page,
  total,
  path,
  params,
}: {
  page: number;
  total: number;
  path: string;
  params: Record<string, string | undefined>;
}) {
  const t = await getTranslations("admin.common");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => Boolean(e[1])));
    return `${path}?${q}`;
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>{t("total", { count: total })}</span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 && <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={href(page - 1)}>{t("prev")}</Link>}
          <span>{t("page", { page, pages })}</span>
          {page < pages && <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={href(page + 1)}>{t("next")}</Link>}
        </div>
      )}
    </div>
  );
}
