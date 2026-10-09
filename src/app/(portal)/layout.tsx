import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { modulesFor } from "@/modules/registry";
import { requireUser } from "@/server/auth/session";
import { env } from "@/server/env";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell user={{ name: user.name, upn: user.upn }} modules={modulesFor(user.roles)} demo={env().authMockEnabled}>
      {children}
    </AppShell>
  );
}
