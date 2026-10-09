"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(portal)/admin/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Action = (state: ActionResult | null, form: FormData) => Promise<ActionResult>;

/**
 * Toast for an action result (texts from admin.result.*). Called right when
 * the action resolves: a successful action often removes the very form that
 * triggered it (e.g. "Make active" disappears), so an effect would never run.
 */
function useResultToast() {
  const t = useTranslations("admin");
  return (state: ActionResult) => {
    const values = { ...state.values };
    if (values.reason) {
      const key = `reasons.${values.reason}` as "reasons.unknown";
      values.reason = t.has(key) ? t(key) : values.reason;
    }
    const text = t(`result.${state.message}` as "result.failed", values);
    if (state.ok) toast.success(text);
    else toast.error(text);
  };
}

/**
 * A form bound to an admin server action. With `confirm`, the submit button
 * opens a confirmation dialog first.
 */
export function ActionForm({
  action,
  fields,
  children,
  label,
  variant = "outline",
  confirm,
  className,
}: {
  action: Action;
  fields?: Record<string, string>;
  /** Extra inputs (for forms the admin fills in). */
  children?: ReactNode;
  label: ReactNode;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost";
  confirm?: { title: string; text: string; action: string };
  className?: string;
}) {
  const tc = useTranslations("admin.common");
  const showResult = useResultToast();
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const result = await action(prev, form);
    showResult(result);
    return result;
  }, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {confirm ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button type="button" size="sm" variant={variant} disabled={pending} />}>
            {label}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.text}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant={variant === "destructive" ? "destructive" : "default"}
                onClick={() => {
                  setOpen(false);
                  formRef.current?.requestSubmit();
                }}
              >
                {confirm.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button type="submit" size="sm" variant={variant} disabled={pending}>
          {label}
        </Button>
      )}
    </form>
  );
}
