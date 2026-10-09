import { AlertTriangleIcon, XIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import * as z from "zod";
import { removeAliasAction, revokeSessionsAction, setAliasAction } from "../actions";
import { ActionForm } from "@/components/admin/action-form";
import { Pagination } from "@/components/admin/pagination";
import { selectClass } from "@/components/admin/styles";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listUnlinkedKeys, listUsers } from "@/server/admin/users";
import { requireAdmin } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("admin.nav"))("users") };
}

const filters = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const OLD_MS = 14 * 86_400_000;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  await requireAdmin();
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const f = filters.parse(await searchParams);
  const [{ rows, total }, unlinked, everyone] = await Promise.all([
    listUsers(f.q || undefined, f.page),
    listUnlinkedKeys(),
    listUsers(undefined, 1),
  ]);
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium", timeStyle: "short" }) : t("common.never"));
  // eslint-disable-next-line react-hooks/purity -- server component, rendered per request
  const now = Date.now();

  return (
    <div className="flex flex-col gap-8">
      <section id="unlinked" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("users.unlinked.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("users.unlinked.intro")}</p>
        </div>
        {unlinked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("users.unlinked.empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <datalist id="user-upns">
              {everyone.rows.map((u) => <option key={u.id} value={u.upn} />)}
            </datalist>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("users.unlinked.key")}</TableHead>
                  <TableHead>{t("users.unlinked.configs")}</TableHead>
                  <TableHead>{t("users.unlinked.since")}</TableHead>
                  <TableHead>{t("users.unlinked.linkTo")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unlinked.map((k) => {
                  const old = now - new Date(k.since).getTime() > OLD_MS;
                  return (
                    <TableRow key={`${k.keyType}:${k.keyValue}`}>
                      <TableCell>
                        <div className="font-mono">{k.keyValue}</div>
                        <div className="text-xs text-muted-foreground">{t(`users.keyType.${k.keyType}`)}</div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <Link className="hover:underline" href={`/admin/configs?status=pending&q=${encodeURIComponent(k.keyValue)}`}>{k.configs}</Link>
                      </TableCell>
                      <TableCell className="text-xs">
                        {date(new Date(k.since))}
                        {old && <div className="flex items-center gap-1 text-amber-500"><AlertTriangleIcon className="size-3" />{t("users.unlinked.old")}</div>}
                      </TableCell>
                      <TableCell>
                        <ActionForm action={setAliasAction} fields={{ keyType: k.keyType, keyValue: k.keyValue }} label={t("users.unlinked.link")} className="flex flex-wrap items-center gap-2">
                          <Input name="userUpn" list="user-upns" required placeholder="name@company.com" className="w-56" aria-label={t("users.unlinked.linkTo")} />
                        </ActionForm>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("nav.users")}</h2>
        <form className="flex flex-wrap items-center gap-2" action="/admin/users">
          <Input name="q" defaultValue={f.q} placeholder={t("users.searchPlaceholder")} className="w-64 max-w-full" />
          <Button type="submit" size="sm">{t("common.search")}</Button>
          <Link href="/admin/users" className={buttonVariants({ size: "sm", variant: "ghost" })}>{t("common.reset")}</Link>
        </form>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("users.columns.user")}</TableHead>
                <TableHead>{t("users.columns.roles")}</TableHead>
                <TableHead>{t("users.columns.lastSignIn")}</TableHead>
                <TableHead>{t("users.columns.keys")}</TableHead>
                <TableHead>{t("users.columns.configs")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("common.noResults")}</TableCell></TableRow>
              )}
              {rows.map((u) => (
                <TableRow key={u.id} className="align-top">
                  <TableCell>
                    <div>{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.upn}</div>
                    {u.conflictWith && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                        <AlertTriangleIcon className="size-3" />
                        {t("users.conflict", { key: u.shortUpn, upn: u.conflictWith })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length ? u.roles.map((r) => <Badge key={r} variant="outline">{r.replace("Portal.", "")}</Badge>) : t("common.none")}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{date(u.lastSignInAt)}</div>
                    <ActionForm
                      action={revokeSessionsAction}
                      fields={{ userId: u.id }}
                      variant="ghost"
                      className="mt-1"
                      label={t("users.revoke")}
                      confirm={{ title: t("users.revokeTitle", { upn: u.upn }), text: t("users.revokeText"), action: t("users.revoke") }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1">
                        {u.aliases.map((a) => (
                          <span key={a.id} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs">
                            {a.keyValue}
                            <span className="font-sans text-muted-foreground">· {t(`users.${a.source}`)}</span>
                            <ActionForm
                              action={removeAliasAction}
                              fields={{ aliasId: a.id }}
                              variant="ghost"
                              label={<XIcon className="size-3" aria-label={t("common.delete")} />}
                              confirm={{ title: t("users.removeTitle", { key: a.keyValue }), text: t("users.removeText"), action: t("common.delete") }}
                            />
                          </span>
                        ))}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("users.addKey")}</summary>
                        <ActionForm action={setAliasAction} fields={{ userId: u.id }} label={t("common.save")} className="mt-2 flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2">
                            <select name="keyType" className={selectClass} aria-label={t("users.addKey")}>
                              <option value="short_upn">{t("users.keyType.short_upn")}</option>
                              <option value="employee_code">{t("users.keyType.employee_code")}</option>
                            </select>
                            <Input name="keyValue" required maxLength={64} placeholder={t("users.keyValue")} className="w-36" />
                          </div>
                          <label className="flex items-start gap-2">
                            <input type="checkbox" name="move" className="mt-0.5" />
                            <span>{t("users.move")}</span>
                          </label>
                        </ActionForm>
                      </details>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <Link className="hover:underline" href={`/admin/configs?q=${encodeURIComponent(u.upn)}`}>{u.activeConfigs}</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Pagination page={f.page} total={total} path="/admin/users" params={{ q: f.q }} />
      </section>
    </div>
  );
}
