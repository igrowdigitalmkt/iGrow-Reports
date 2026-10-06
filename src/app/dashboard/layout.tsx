import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { isSidebarCollapsed, SIDEBAR_COOKIE } from "@/components/layout/sidebar-state";
import { requireAgencyContext } from "@/modules/agencies/context";
import { roleLabels } from "@/modules/agencies/roles";

// The shell lives in the layout so the menu stays mounted while sections load.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const context = await requireAgencyContext();
  const collapsed = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);
  const { count } = await context.supabase.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", context.agency.id).is("archived_at", null);
  return <AppShell key={context.agency.id} demo={false} initialCollapsed={collapsed} clientCount={count ?? undefined}
    identity={{ agencyName: context.agency.name, userName: context.user.email?.split("@")[0] ?? "Gestor", roleLabel: roleLabels[context.role], timezone: context.agency.timezone }}>
    {children}
  </AppShell>;
}
