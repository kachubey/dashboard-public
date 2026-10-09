import { DownloadIcon, LifeBuoyIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/vpn/markdown";
import { VlessCard } from "@/components/vpn/vless-card";
import { requireUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { loadInstructions } from "@/server/vpn/instructions";
import { listAllConfigsForUser } from "@/server/vpn/providers";
import type { UserConfigSummary } from "@/server/vpn/repository";
import { CONFIG_TYPES, type ConfigTypeDef } from "@/server/vpn/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("vpn"))("title") };
}

async function Instructions({ type }: { type: string }) {
  const t = await getTranslations("vpn");
  const doc = await loadInstructions(type, await getLocale());
  if (!doc) return null;
  return (
    <Accordion>
      <AccordionItem value="how">
        <AccordionTrigger>{t("howToConnect")}</AccordionTrigger>
        <AccordionContent>
          {doc.fallback && <p className="mb-2 text-xs text-muted-foreground italic">{t("instructionsFallback")}</p>}
          <Markdown>{doc.markdown}</Markdown>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

async function FileCard({ config, updated }: { config: UserConfigSummary; updated: string }) {
  const t = await getTranslations("vpn");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-mono">{config.label}</CardTitle>
        <CardDescription>{updated}</CardDescription>
      </CardHeader>
      <CardContent>
        <a href={`/api/vpn/configs/${config.id}/download`} className={buttonVariants({ size: "sm" })}>
          <DownloadIcon />
          {t("download")}
        </a>
      </CardContent>
    </Card>
  );
}

async function TypeSection({ def, configs }: { def: ConfigTypeDef; configs: UserConfigSummary[] }) {
  const t = await getTranslations("vpn");
  const format = await getFormatter();
  const updated = (c: UserConfigSummary) => t("updated", { date: format.dateTime(c.updatedAt, { dateStyle: "medium" }) });

  const cards = (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      {configs.map((c) =>
        def.revealable ? (
          <VlessCard key={c.id} id={c.id} label={c.label} updated={updated(c)} />
        ) : (
          <FileCard key={c.id} config={c} updated={updated(c)} />
        ),
      )}
    </div>
  );
  const typeKey = def.id as "pritunl" | "vless" | "wg";

  if (def.legacy) {
    // Legacy types start collapsed so they don't compete with the primary ones.
    return (
      <section className="rounded-xl border">
        <Accordion>
          <AccordionItem value="legacy" className="px-4">
            <AccordionTrigger>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">{t(`types.${typeKey}.title`)}</span>
                <Badge variant="outline">{t("legacyBadge")}</Badge>
                <span className="text-sm font-normal text-muted-foreground">{t("configCount", { count: configs.length })}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t(`types.${typeKey}.description`)}</p>
              {cards}
              <Instructions type={def.id} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t(`types.${typeKey}.title`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`types.${typeKey}.description`)}</p>
      </div>
      {cards}
      <Instructions type={def.id} />
    </section>
  );
}

export default async function VpnPage() {
  const user = await requireUser();
  const t = await getTranslations("vpn");
  const configs = await listAllConfigsForUser(user);
  const sections = CONFIG_TYPES.map((def) => ({ def, configs: configs.filter((c) => c.type === def.id) })).filter(
    (s) => s.configs.length > 0,
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {sections.length > 0 && <p className="text-muted-foreground">{t("intro")}</p>}
      </div>

      {sections.length === 0 ? (
        <Card>
          <CardHeader>
            <LifeBuoyIcon className="mb-2 size-6 text-muted-foreground" />
            <CardTitle>{t("emptyTitle")}</CardTitle>
            <CardDescription>{t("emptyText")}</CardDescription>
          </CardHeader>
          <CardContent>
            <a href={env().SUPPORT_URL} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
              {t("support")}
            </a>
          </CardContent>
        </Card>
      ) : (
        sections.map((s) => <TypeSection key={s.def.id} def={s.def} configs={s.configs} />)
      )}
    </div>
  );
}
