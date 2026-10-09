import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import * as z from "zod";
import { Pagination } from "@/components/admin/pagination";
import { dateClass, selectClass } from "@/components/admin/styles";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryAudit } from "@/server/admin/audit-log";
import { requireAdmin } from "@/server/auth/session";
import { schema } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin.nav"))("audit") };
}

const filters = z.object({
  user: z.string().trim().max(200).optional().catch(undefined),
  action: z.enum(schema.auditAction.enumValues).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

function short(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  await requireAdmin();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const f = filters.parse(await searchParams);
  const params = { user: f.user || undefined, action: f.action, from: f.from, to: f.to };
  const { rows, total } = await queryAudit({ ...params, page: f.page });
  const exportQuery = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-2" action="/admin/audit">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("audit.user")}
          <Input name="user" defaultValue={f.user} className="w-56" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("audit.action")}
          <select name="action" defaultValue={f.action ?? ""} className={selectClass}>
            <option value="">{t("audit.allActions")}</option>
            {schema.auditAction.enumValues.map((a) => <option key={a} value={a}>{t(`auditActions.${a}`)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("audit.from")}
          <input type="date" name="from" defaultValue={f.from} className={dateClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("audit.to")}
          <input type="date" name="to" defaultValue={f.to} className={dateClass} />
        </label>
        <Button type="submit" size="sm">{t("common.apply")}</Button>
        <Link href="/admin/audit" className={buttonVariants({ size: "sm", variant: "ghost" })}>{t("common.reset")}</Link>
        <a href={`/api/admin/audit/export?${exportQuery}`} title={t("audit.exportHint")} className={buttonVariants({ size: "sm", variant: "outline", className: "ml-auto" })}>
          <DownloadIcon />
          {t("audit.export")}
        </a>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("audit.columns.time")}</TableHead>
              <TableHead>{t("audit.columns.actor")}</TableHead>
              <TableHead>{t("audit.columns.action")}</TableHead>
              <TableHead>{t("audit.columns.target")}</TableHead>
              <TableHead>{t("audit.columns.ip")}</TableHead>
              <TableHead>{t("audit.columns.details")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("audit.empty")}</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs whitespace-nowrap tabular-nums">{format.dateTime(r.at, { dateStyle: "short", timeStyle: "medium" })}</TableCell>
                <TableCell className="text-xs">{r.actorUpn ?? t("common.none")}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{t(`auditActions.${r.action}`)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.targetConfigId ? (
                    r.targetLabel ? <Link className="hover:underline" href={`/admin/configs/${r.targetConfigId}`}>{r.targetLabel}</Link> : r.targetConfigId.slice(0, 8)
                  ) : t("common.none")}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.ip ?? t("common.none")}</TableCell>
                <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={short(r.details)}>{short(r.details)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={f.page} total={total} path="/admin/audit" params={params} />
    </div>
  );
}
