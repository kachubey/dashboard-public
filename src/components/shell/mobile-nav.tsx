"use client";

import { MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { PortalModule } from "@/modules/registry";
import { Nav } from "./nav";

export function MobileNav({ modules }: { modules: PortalModule[] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" />}
        aria-label={t("header.openMenu")}
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-4">
        <SheetTitle className="px-3 py-2 text-base">{t("app.name")}</SheetTitle>
        <Nav modules={modules} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
