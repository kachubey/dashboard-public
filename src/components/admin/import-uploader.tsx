"use client";

import { FileUpIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ImportPlan, PlanItem } from "@/server/vpn/import/pipeline";

const ACTION_VARIANT: Record<PlanItem["action"], "default" | "secondary" | "outline" | "destructive"> = {
  create: "default",
  replace: "secondary",
  unchanged: "outline",
  quarantine: "destructive",
};

export function ImportUploader() {
  const t = useTranslations("admin");
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ plan: ImportPlan; fingerprint: string } | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const byName = new Map(files.map((f) => [f.name, f]));
    for (const f of Array.from(list)) byName.set(f.name, f);
    setFiles([...byName.values()]);
    setPreview(null);
  }

  async function send(mode: "preview" | "commit") {
    const body = new FormData();
    body.set("mode", mode);
    if (mode === "commit" && preview) body.set("fingerprint", preview.fingerprint);
    for (const f of files) body.append("files", f, f.name);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/import", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        const key = `import.errors.${data.error}`;
        toast.error(t.has(key as "import.errors.failed") ? t(key as "import.errors.failed") : t("import.errors.failed"));
        if (data.error === "stale_preview") setPreview(null);
        return;
      }
      if (mode === "preview") {
        setPreview(data);
      } else {
        toast.success(t("import.done", { ...data.plan.summary }));
        setFiles([]);
        setPreview(null);
      }
    } catch {
      toast.error(t("import.errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  const s = preview?.plan.summary;
  const toWrite = s ? s.create + s.replace : 0;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center text-sm text-muted-foreground transition-colors",
          dragging ? "border-primary bg-muted" : "hover:border-muted-foreground/50",
        )}
      >
        <FileUpIcon className="size-8" />
        {t("import.drop")}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".ovpn,.tar,.txt,.conf,.csv"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("import.selected", { count: files.length })}</span>
          <Button size="sm" variant="ghost" onClick={() => { setFiles([]); setPreview(null); }} disabled={busy}>
            <XIcon />
            {t("import.clear")}
          </Button>
          <Button size="sm" onClick={() => send("preview")} disabled={busy} className="ml-auto">
            {busy && !preview ? t("import.working") : t("import.preview")}
          </Button>
        </div>
      )}

      {preview && s && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("import.summary", { ...s })}</p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("import.columns.source")}</TableHead>
                  <TableHead>{t("import.columns.owner")}</TableHead>
                  <TableHead>{t("import.columns.type")}</TableHead>
                  <TableHead>{t("import.columns.label")}</TableHead>
                  <TableHead>{t("import.columns.match")}</TableHead>
                  <TableHead>{t("import.columns.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.plan.items.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-56 truncate font-mono text-xs" title={item.source}>{item.source}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono">{item.ownerKey ?? t("common.none")}</div>
                      <div className="text-muted-foreground">
                        {item.owner?.upn ?? (item.match === "pending" ? t("import.waitsForSignIn") : "")}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{item.type ?? t("common.none")}</TableCell>
                    <TableCell className="font-mono text-xs">{item.label ?? t("common.none")}</TableCell>
                    <TableCell className="text-xs">{t(`import.match.${item.match}`)}</TableCell>
                    <TableCell className="min-w-48 max-w-72 text-xs whitespace-normal [overflow-wrap:anywhere]">
                      <Badge variant={ACTION_VARIANT[item.action]}>{t(`import.action.${item.action}`)}</Badge>
                      {item.reactivates && item.action !== "quarantine" && (
                        <span className="ml-1 text-muted-foreground">({t("import.reactivates")})</span>
                      )}
                      {item.ownerChange && <div className="mt-1 text-amber-500">{t("import.ownerChange")}</div>}
                      {item.reason && (
                        <div className="mt-1 text-destructive">
                          {t.has(`reasons.${item.reason}` as "reasons.unknown") ? t(`reasons.${item.reason}` as "reasons.unknown") : item.reason}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {toWrite + s.quarantine > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => send("commit")} disabled={busy}>
                {busy ? t("import.working") : t("import.commit", { count: toWrite })}
              </Button>
              {s.quarantine > 0 && (
                <span className="text-sm text-muted-foreground">{t("import.commitQuarantine", { count: s.quarantine })}</span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("import.nothingToDo")}</p>
          )}
        </div>
      )}
    </div>
  );
}
