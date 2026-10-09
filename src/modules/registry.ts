import { ROLES, type Role } from "@/server/auth/roles";

// Portal sections. To add a module: add an entry here, a label under
// `modules.<id>` in messages/*.json, an icon in components/shell/nav-icons.tsx,
// and a route folder under src/app/(portal)/.

export type ModuleId = "home" | "vpn" | "documents" | "instructions" | "admin";

export interface PortalModule {
  id: ModuleId;
  href: string;
  /** `coming_soon` modules are listed but not clickable. */
  status: "active" | "coming_soon";
  /** If set, the module is hidden from users without this role. */
  requiredRole?: Role;
}

export const MODULES: readonly PortalModule[] = [
  { id: "home", href: "/", status: "active" },
  { id: "vpn", href: "/vpn", status: "active" },
  { id: "documents", href: "/documents", status: "coming_soon" },
  { id: "instructions", href: "/instructions", status: "coming_soon" },
  { id: "admin", href: "/admin", status: "active", requiredRole: ROLES.admin },
];

export function modulesFor(roles: readonly string[]): PortalModule[] {
  return MODULES.filter((m) => !m.requiredRole || roles.includes(m.requiredRole));
}
