import { notFound } from "next/navigation";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency, roleLabels } from "@/modules/agencies/roles";
import { DashboardWorkspace } from "@/modules/operations/dashboard-workspace";
import type { ClientItem } from "@/modules/clients/schema";
import { getAgencyClientPortalAccesses } from "@/modules/client-portal/admin";
import type { ClientPortalAdminAccess } from "@/modules/client-portal/types";
import { getMetaAdminSnapshot } from "@/modules/meta/admin";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import { getReportsAdminSnapshot } from "@/modules/reports/admin";
import type { ReportsAdminSnapshot } from "@/modules/reports/types";

const sections = ["", "clientes", "relatorios", "templates", "agendamentos", "entregas", "integracoes", "configuracoes"];
export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const context = await requireAgencyContext();
  const { section = [] } = await params;
  const key = section.join("/");
  if (!sections.includes(key)) notFound();
  const { count, error } = await context.supabase.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", context.agency.id).is("archived_at", null);
  if (error) throw new Error("Não foi possível consultar os clientes da agência.");
  const clients: ClientItem[] = [];
  let portalAccesses: ClientPortalAdminAccess[] = [];
  let clientPortalAdminReady = false;
  let metaSnapshot: MetaAdminSnapshot | undefined;
  let reportsSnapshot: ReportsAdminSnapshot | undefined;
  const canManageClientAccess = canManageAgency(context.role);
  if (key === "clientes" || key === "relatorios") {
    for (let offset = 0; ; offset += 500) {
      const result = await context.supabase.from("clients").select("id,name,notes,archived_at,updated_at")
        .eq("agency_id", context.agency.id).order("name").order("id").range(offset, offset + 499);
      if (result.error) throw new Error("Não foi possível consultar os clientes.");
      clients.push(...result.data);
      if (result.data.length < 500) break;
    }
    if (key === "clientes" && canManageClientAccess) {
      const portalAdmin = await getAgencyClientPortalAccesses(context.supabase, context.agency.id);
      portalAccesses = portalAdmin.accesses;
      clientPortalAdminReady = portalAdmin.ready;
    }
  }
  if (key === "clientes" || key === "integracoes") {
    metaSnapshot = await getMetaAdminSnapshot(context.supabase, context.agency.id);
  }
  if (key === "relatorios") {
    reportsSnapshot = await getReportsAdminSnapshot(context.supabase, context.agency.id);
  }
  return <DashboardWorkspace key={context.agency.id} demo={false} section={key} clients={clients} agencyId={context.agency.id} canEditClients={context.role !== "viewer"} canManageClientAccess={canManageClientAccess} clientPortalAdminReady={clientPortalAdminReady} portalAccesses={portalAccesses} metaSnapshot={metaSnapshot} reportsSnapshot={reportsSnapshot} activeClients={count ?? 0} identity={{ agencyName: context.agency.name, userName: context.user.email?.split("@")[0] ?? "Gestor", roleLabel: roleLabels[context.role], timezone: context.agency.timezone }} />;
}
