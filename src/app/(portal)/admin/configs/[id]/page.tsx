import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import * as z from "zod";
import { deleteConfigAction, rollbackConfigAction, setConfigStatusAction } from "../../actions";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getConfigDetail } from "@/server/admin/configs";
import { requireAdmin } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin.nav"))("configs") };
}

export default async function AdminConfigPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getConfigDetail(id);
  if (!detail) notFound();
  const { config, versions } = detail;
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium", timeStyle: "short" }) : t("common.never"));
  const deleted = config.status === "deleted";

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/configs" className={buttonVariants({ size: "sm", variant: "ghost", className: "self-start" })}>
        <ArrowLeftIcon />
        {t("configs.back")}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{config.type} / {config.label}</span>
            <Badge variant={config.status === "active" ? "secondary" : config.status === "deleted" ? "destructive" : "outline"}>
              {t(`configs.statusLabel.${config.status}`)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t("configs.columns.owner")}</dt>
            <dd>
              {config.userUpn ? `${config.userName} · ${config.userUpn}` : <Badge variant="outline" className="text-amber-500">{t("configs.waitingForOwner")}</Badge>}
            </dd>
            <dt className="text-muted-foreground">{t("configs.ownerKey")}</dt>
            <dd className="font-mono">{config.ownerKeyValue} <span className="text-xs text-muted-foreground">({t(`users.keyType.${config.ownerKeyType}`)})</span></dd>
            <dt className="text-muted-foreground">{t("configs.columns.downloaded")}</dt>
            <dd>{date(config.lastDownloadedAt)}</dd>
          </dl>
          {config.orphaned && (
            <p className="rounded-lg border border-amber-500/40 p-3 text-xs text-amber-500">{t("configs.orphanedHint")}</p>
          )}
          <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <ShieldAlertIcon className="size-4 shrink-0" />
            <span>{t("configs.noContentAccess")} {t("configs.replaceHint")}</span>
          </p>
          {!deleted && (
            <div className="flex flex-wrap gap-2">
              {config.status === "active" ? (
                <ActionForm action={setConfigStatusAction} fields={{ configId: config.id, status: "deactivated" }} label={t("configs.deactivate")} />
              ) : (
                <ActionForm action={setConfigStatusAction} fields={{ configId: config.id, status: "active" }} label={t("configs.reactivate")} />
              )}
              <ActionForm
                action={deleteConfigAction}
                fields={{ configId: config.id }}
                label={t("common.delete")}
                variant="destructive"
                confirm={{ title: t("configs.deleteTitle"), text: t("configs.deleteText"), action: t("common.delete") }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {versions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("configs.versions")}</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("configs.columns.version")}</TableHead>
                  <TableHead>{t("configs.created")}</TableHead>
                  <TableHead>{t("import.columns.source")}</TableHead>
                  <TableHead>{t("configs.importedBy")}</TableHead>
                  <TableHead>{t("configs.size")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="tabular-nums">
                      v{v.version} {v.isActive && <Badge variant="secondary">{t("configs.activeVersion")}</Badge>}
                    </TableCell>
                    <TableCell className="text-xs">{date(v.createdAt)}</TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs" title={`${v.originalFilename} · sha256 ${v.sha256}`}>
                      {v.originalFilename} <span className="text-muted-foreground">({v.source})</span>
                    </TableCell>
                    <TableCell className="text-xs">{v.importedByUpn ?? t("common.none")}</TableCell>
                    <TableCell className="text-xs tabular-nums">{format.number(v.sizeBytes)} B</TableCell>
                    <TableCell>
                      {!v.isActive && (
                        <ActionForm
                          action={rollbackConfigAction}
                          fields={{ configId: config.id, versionId: v.id }}
                          label={t("configs.rollback")}
                          confirm={{
                            title: t("configs.rollbackTitle", { version: v.version }),
                            text: t("configs.rollbackText"),
                            action: t("configs.rollback"),
                          }}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
