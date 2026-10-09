import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PortalModule } from "@/modules/registry";
import { MobileNav } from "./mobile-nav";
import { Nav } from "./nav";
import { LocaleSwitcher, ThemeToggle, UserMenu } from "./user-menu";

export function AppShell({
  user,
  modules,
  children,
  demo = false,
}: {
  user: { name: string; upn: string };
  modules: PortalModule[];
  children: ReactNode;
  demo?: boolean;
}) {
  const t = useTranslations("app");
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Link href="/" className="px-3 py-2 text-base font-semibold tracking-tight">
          {t("name")}
        </Link>
        <Nav modules={modules} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <MobileNav modules={modules} />
          <span className="truncate font-semibold md:hidden">{t("name")}</span>
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
            <UserMenu name={user.name} upn={user.upn} />
          </div>
        </header>
        {demo && <p role="status" className="border-b bg-muted px-4 py-2 text-center text-sm text-muted-foreground">{t("demoBanner")}</p>}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
