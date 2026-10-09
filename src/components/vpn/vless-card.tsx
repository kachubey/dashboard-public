"use client";

import { CheckIcon, CopyIcon, DownloadIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revealConfig } from "@/app/(portal)/vpn/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function VlessCard({
  id,
  label,
  updated,
}: {
  id: string;
  label: string;
  updated: string;
}) {
  const t = useTranslations("vpn");
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function reveal() {
    startTransition(async () => {
      const result = await revealConfig(id);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      setLink(result.link);
      // Rendered locally in the browser; the link never goes to a third party.
      setQr(await QRCode.toDataURL(result.link, { margin: 1, width: 240, errorCorrectionLevel: "M" }));
    });
  }

  function hide() {
    setLink(null);
    setQr(null);
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-mono">{label}</CardTitle>
        <CardDescription>{updated}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {link ? (
          <>
            <code className="block max-h-28 overflow-auto rounded-md bg-muted p-2 font-mono text-xs break-all select-all">
              {link}
            </code>
            {qr && (
              <figure className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL */}
                <img src={qr} alt="QR" width={240} height={240} className="rounded-md bg-white p-2" />
                <figcaption className="text-center text-xs text-muted-foreground">{t("qrHint")}</figcaption>
              </figure>
            )}
          </>
        ) : (
          <p className="rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground">
            vless://••••••••••••••••••••
            <span className="mt-1 block font-sans">{t("maskedHint")}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {link ? (
            <>
              <Button size="sm" onClick={copy}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? t("copied") : t("copy")}
              </Button>
              <Button size="sm" variant="outline" onClick={hide}>
                <EyeOffIcon />
                {t("hideLink")}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={reveal} disabled={pending}>
              <EyeIcon />
              {t("showLink")}
            </Button>
          )}
          <a href={`/api/vpn/configs/${id}/download`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            <DownloadIcon />
            {t("downloadTxt")}
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
