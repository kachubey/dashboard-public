"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", href: "/admin" },
  { id: "import", href: "/admin/import" },
  { id: "configs", href: "/admin/configs" },
  { id: "users", href: "/admin/users" },
  { id: "quarantine", href: "/admin/quarantine" },
  { id: "audit", href: "/admin/audit" },
] as const;

export function AdminNav({ counts }: { counts: { quarantine: number; pending: number } }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const badge = { quarantine: counts.quarantine, users: counts.pending } as Record<string, number>;

  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
      {TABS.map((tab) => {
        const active = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.id)}
            {badge[tab.id] ? (
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{badge[tab.id]}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
