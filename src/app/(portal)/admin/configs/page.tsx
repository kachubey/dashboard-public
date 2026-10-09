import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import * as z from "zod";
import { Pagination } from "@/components/admin/pagination";
import { selectClass } from "@/components/admin/styles";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONFIG_STATUS_FILTERS, listConfigs } from "@/server/admin/configs";
import { requireAdmin } from "@/server/auth/session";
import { CONFIG_TYPES } from "@/server/vpn/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin.nav"))("configs") };
}

const filters = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(CONFIG_TYPES.map((t) => t.id) as [string, ...string[]]).optional().catch(undefined),
  status: z.enum(CONFIG_STATUS_FILTERS).catch("live"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function AdminConfigsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  await requireAdmin();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const f = filters.parse(await searchParams);
  const { rows, total } = await listConfigs({ ...f, q: f.q || undefined });
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium", timeStyle: "short" }) : null);

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-center gap-2" action="/admin/configs">
        <Input name="q" defaultValue={f.q} placeholder={t("configs.searchPlaceholder")} className="w-64 max-w-full" />
        <select name="type" defaultValue={f.type ?? ""} className={selectClass} aria-label={t("configs.columns.type")}>
          <option value="">{t("common.allTypes")}</option>
          {CONFIG_TYPES.map((ct) => <option key={ct.id} value={ct.id}>{ct.id}</option>)}
        </select>
        <select name="status" defaultValue={f.status} className={selectClass} aria-label={t("configs.columns.status")}>
          {CONFIG_STATUS_FILTERS.map((s) => <option key={s} value={s}>{t(`configs.status.${s}`)}</option>)}
        </select>
        <Button type="submit" size="sm">{t("common.apply")}</Button>
        <Link href="/admin/configs" className={buttonVariants({ size: "sm", variant: "ghost" })}>{t("common.reset")}</Link>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("configs.columns.owner")}</TableHead>
              <TableHead>{t("configs.columns.type")}</TableHead>
              <TableHead>{t("configs.columns.label")}</TableHead>
              <TableHead>{t("configs.columns.version")}</TableHead>
              <TableHead>{t("configs.columns.updated")}</TableHead>
              <TableHead>{t("configs.columns.downloaded")}</TableHead>
              <TableHead>{t("configs.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("common.noResults")}</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/admin/configs/${r.id}`} className="hover:underline">
                    {r.userUpn ? (
                      <>
                        <div>{r.userName}</div>
                        <div className="text-xs text-muted-foreground">{r.userUpn}</div>
                        {r.orphaned && <Badge variant="outline" className="text-amber-500">{t("configs.orphaned")}</Badge>}
                      </>
                    ) : (
                      <><div className="font-mono">{r.ownerKeyValue}</div><Badge variant="outline" className="text-amber-500">{t("configs.waitingForOwner")}</Badge></>
                    )}
                  </Link>
                </TableCell>
                <TableCell>{r.type}</TableCell>
                <TableCell className="font-mono">{r.label}</TableCell>
                <TableCell className="tabular-nums">{r.version ? `v${r.version}` : t("common.none")}</TableCell>
                <TableCell className="text-xs">{date(r.versionAt) ?? t("common.none")}</TableCell>
                <TableCell className="text-xs">
                  {date(r.lastDownloadedAt) ?? <span className={r.status === "active" ? "text-amber-500" : "text-muted-foreground"}>{t("common.never")}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "active" ? "secondary" : r.status === "deleted" ? "destructive" : "outline"}>
                    {t(`configs.statusLabel.${r.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={f.page} total={total} path="/admin/configs" params={{ q: f.q, type: f.type, status: f.status }} />
    </div>
  );
}
