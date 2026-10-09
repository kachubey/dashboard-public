import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { deleteQuarantineAction, resolveQuarantineAction } from "../actions";
import { ActionForm } from "@/components/admin/action-form";
import { selectClass } from "@/components/admin/styles";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listQuarantine } from "@/server/admin/quarantine";
import { requireAdmin } from "@/server/auth/session";
import { CONFIG_TYPES } from "@/server/vpn/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin.nav"))("quarantine") };
}

export default async function AdminQuarantinePage() {
  await requireAdmin();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const items = await listQuarantine();
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const reason = (code: string) => (t.has(`reasons.${code}` as "reasons.unknown") ? t(`reasons.${code}` as "reasons.unknown") : code);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("quarantine.intro")}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("quarantine.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("quarantine.columns.file")}</TableHead>
                <TableHead>{t("quarantine.columns.reason")}</TableHead>
                <TableHead>{t("quarantine.columns.added")}</TableHead>
                <TableHead>{t("quarantine.columns.expires")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((q) => (
                <TableRow key={q.id} className="align-top">
                  <TableCell className="max-w-56">
                    <div className="truncate font-mono text-xs" title={q.originalFilename}>{q.originalFilename}</div>
                    <div className="text-xs text-muted-foreground">{format.number(q.sizeBytes)} B · {q.source}</div>
                  </TableCell>
                  <TableCell className="min-w-48 max-w-64 text-xs whitespace-normal text-destructive [overflow-wrap:anywhere]">{reason(q.reason)}</TableCell>
                  <TableCell className="text-xs">
                    {date(q.createdAt)}
                    <div className="text-muted-foreground">{q.createdByUpn}</div>
                  </TableCell>
                  <TableCell className="text-xs">{date(q.expiresAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-2">
                      {q.hasContent ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("quarantine.fix")}</summary>
                          <ActionForm action={resolveQuarantineAction} fields={{ itemId: q.id }} label={t("quarantine.accept")} variant="default" className="mt-2 flex flex-wrap items-center gap-2">
                            <Input name="ownerKey" required defaultValue={q.parsed?.ownerKey} placeholder={t("users.unlinked.key")} className="w-28" aria-label={t("users.unlinked.key")} />
                            <select name="type" defaultValue={CONFIG_TYPES.some((c) => c.id === q.parsed?.type) ? q.parsed?.type : undefined} className={selectClass} aria-label={t("configs.columns.type")}>
                              {CONFIG_TYPES.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                            </select>
                            <Input name="label" required defaultValue={q.parsed?.label} placeholder={t("configs.columns.label")} className="w-24" aria-label={t("configs.columns.label")} />
                          </ActionForm>
                        </details>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("quarantine.noContent")}</span>
                      )}
                      <ActionForm
                        action={deleteQuarantineAction}
                        fields={{ itemId: q.id }}
                        label={t("common.delete")}
                        variant="destructive"
                        confirm={{ title: t("quarantine.deleteTitle"), text: t("quarantine.deleteText"), action: t("common.delete") }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
