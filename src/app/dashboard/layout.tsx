import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { isSidebarCollapsed, SIDEBAR_COOKIE } from "@/components/layout/sidebar-state";
import { requireAgencyContext } from "@/modules/agencies/context";
import { roleLabels } from "@/modules/agencies/roles";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";

// The shell lives in the layout so the menu stays mounted while sections load.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const context = await requireAgencyContext();
  const collapsed = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);
  const { count } = await context.supabase.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", context.agency.id).is("archived_at", null);
  // Areas limited for this member (Equipe › Permissões) disappear from the menu; Equipe is for owners and admins.
  const modules = context.role === "owner" || context.role === "admin" ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  const hiddenKeys = [["", ""], ["clientes", "clientes"], ["relatorios", "relatorios-visao"], ["agendamentos", "agendamentos"], ["integracoes", "integracoes"]]
    .filter(([, section]) => !canOpenSection(context.role, modules, section)).map(([key]) => key);
  const metadata = context.user.user_metadata as { full_name?: string; avatar_url?: string } | undefined;
  return <AppShell key={context.agency.id} demo={false} initialCollapsed={collapsed} clientCount={count ?? undefined} workspaceCount={context.memberships.length} hiddenKeys={hiddenKeys}
    identity={{ agencyName: context.agency.name, userName: metadata?.full_name?.trim() || (context.user.email?.split("@")[0] ?? "Gestor"), roleLabel: roleLabels[context.role], timezone: context.agency.timezone, avatarUrl: metadata?.avatar_url ?? null }}>
    {children}
  </AppShell>;
}
