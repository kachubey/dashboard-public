"use client";

import {
  BookOpenIcon,
  FileTextIcon,
  HouseIcon,
  SettingsIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ModuleId, PortalModule } from "@/modules/registry";

const ICONS: Record<ModuleId, LucideIcon> = {
  home: HouseIcon,
  vpn: ShieldCheckIcon,
  documents: FileTextIcon,
  instructions: BookOpenIcon,
  admin: SettingsIcon,
};

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav({
  modules,
  onNavigate,
}: {
  modules: PortalModule[];
  onNavigate?: () => void;
}) {
  const t = useTranslations("modules");
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {modules.map((m) => {
        const Icon = ICONS[m.id];
        const label = t(m.id);
        if (m.status === "coming_soon") {
          return (
            <span
              key={m.id}
              aria-disabled="true"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/60"
            >
              <Icon className="size-4" />
              <span className="flex-1">{label}</span>
              <Badge variant="outline" className="text-[0.65rem] font-normal">
                {t("comingSoon")}
              </Badge>
            </span>
          );
        }
        const active = isActive(pathname, m.href);
        return (
          <Link
            key={m.id}
            href={m.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
