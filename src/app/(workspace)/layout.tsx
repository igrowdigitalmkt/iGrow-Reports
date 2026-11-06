import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { isSidebarCollapsed, SIDEBAR_COOKIE } from "@/components/layout/sidebar-state";
import { loadAiCredits } from "@/modules/ai/credits-usage";
import { requireAgencyViewContext } from "@/modules/agencies/context";
import { roleLabels } from "@/modules/agencies/roles";
import { loadOwnModules } from "@/modules/team/admin";
import { unreadConversationCount } from "@/modules/whatsapp/unread-count";
import { canOpenSection } from "@/modules/team/permissions";

// The shell lives in the layout so the menu stays mounted while sections load.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const context = await requireAgencyViewContext();
  const collapsed = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);
  // Leituras independentes saem juntas (antes eram 4 viagens em fila ao banco a cada navegação).
  const clientCountQuery = context.supabase.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", context.agency.id).is("archived_at", null);
  const aiCreditsQuery = loadAiCredits(context.agency.id);
  // Areas limited for this member (Equipe › Permissões) disappear from the menu; Equipe is for owners and admins.
  const modules = context.role === "owner" || context.role === "admin" ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  const hiddenKeys = [["", ""], ["clientes", "clientes"], ["relatorios", "relatorios-visao"], ["agendamentos", "agendamentos"], ["integracoes", "integracoes"], ["whatsapp", "whatsapp"]]
    .filter(([, section]) => !canOpenSection(context.role, modules, section)).map(([key]) => key);
  // Unread conversations of the WhatsApp inbox (0 before its migration or without access).
  const [{ count }, unread, aiCredits] = await Promise.all([
    clientCountQuery,
    hiddenKeys.includes("whatsapp") ? Promise.resolve(0) : unreadConversationCount(context.supabase, context.agency.id),
    aiCreditsQuery,
  ]);
  const metadata = context.user.user_metadata as { full_name?: string; avatar_url?: string } | undefined;
  return <AppShell key={context.agency.id} demo={false} initialCollapsed={collapsed} clientCount={count ?? undefined} whatsappUnread={unread} workspaceCount={context.memberships.length} hiddenKeys={hiddenKeys} aiCredits={aiCredits}
    identity={{ agencyName: context.agency.name, userName: metadata?.full_name?.trim() || (context.user.email?.split("@")[0] ?? "Gestor"), roleLabel: roleLabels[context.role], timezone: context.agency.timezone, avatarUrl: metadata?.avatar_url ?? null, email: context.user.email ?? undefined, agencyId: context.agency.id, canAdmin: context.role === "owner" || context.role === "admin" }}>
    {children}
  </AppShell>;
}
