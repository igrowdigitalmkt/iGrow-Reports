import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadPortfolioRows } from "@/modules/operations/portfolio-data";
import { PortfolioView } from "@/modules/operations/portfolio-view";
import { PortfolioSkeleton } from "@/modules/operations/portfolio-skeleton";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency, roleLabels } from "@/modules/agencies/roles";
import { DashboardWorkspace } from "@/modules/operations/dashboard-workspace";
import type { ClientItem } from "@/modules/clients/schema";
import { getAgencyClientPortalAccesses } from "@/modules/client-portal/admin";
import type { ClientPortalAdminAccess, ClientPortalPendingInvitation } from "@/modules/client-portal/types";
import { getMetaAdminSnapshot } from "@/modules/meta/admin";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import { getReportsAdminSnapshot } from "@/modules/reports/admin";
import type { ReportsAdminSnapshot } from "@/modules/reports/types";
import { loadDeliveries, loadSendableRecipients, loadWhatsAppSummary } from "@/modules/whatsapp/admin";
import { whatsAppEmbeddedSignup, whatsAppReadiness } from "@/modules/whatsapp/server";
import { loadAutomations } from "@/modules/automations/admin";
import { getQrStatus } from "@/modules/whatsapp-qr/server";
import { loadMessageTemplates } from "@/modules/templates/admin";
import { legacyRedirect, SECTION_ROUTES } from "@/modules/operations/routes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ client?: string; clientId?: string; from?: string; to?: string; periodo?: string; cliente?: string }>;
}) {
  const context = await requireAgencyContext();
  const { section = [] } = await params;
  const query = await searchParams;
  const path = section.join("/");
  const legacy = legacyRedirect("/dashboard", path, query);
  if (legacy) redirect(legacy);
  const key = SECTION_ROUTES[path];
  if (key === undefined) notFound();
  const { count, error } = await context.supabase.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", context.agency.id).is("archived_at", null);
  if (error) throw new Error("Não foi possível consultar os clientes deste espaço de trabalho.");
  const clients: ClientItem[] = [];
  let portalAccesses: ClientPortalAdminAccess[] = [];
  let portalInvitations: ClientPortalPendingInvitation[] = [];
  let clientPortalAdminReady = false;
  let metaSnapshot: MetaAdminSnapshot | undefined;
  let reportsSnapshot: ReportsAdminSnapshot | undefined;
  const canManageClientAccess = canManageAgency(context.role);
  if (key === "" || key === "clientes" || key === "relatorios" || key === "integracoes" || key === "entregas" || key === "agendamentos" || key === "templates" || key === "relatorios-visao") {
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
      portalInvitations = portalAdmin.invitations;
      clientPortalAdminReady = portalAdmin.ready;
    }
  }
  if (key === "" || key === "clientes" || key === "integracoes") {
    metaSnapshot = await getMetaAdminSnapshot(context.supabase, context.agency.id);
  }
  if (key === "" || key === "relatorios" || key === "entregas" || key === "relatorios-visao") {
    reportsSnapshot = await getReportsAdminSnapshot(context.supabase, context.agency.id);
  }
  const whatsapp = key === "integracoes" || key === "relatorios" || key === "entregas" ? await loadWhatsAppSummary(context.supabase, context.agency.id) : null;
  const recipients = key === "relatorios" || key === "agendamentos" ? await loadSendableRecipients(context.supabase, context.agency.id) : [];
  const deliveries = key === "entregas" || key === "relatorios-visao" ? await loadDeliveries(context.supabase, context.agency.id, clients, reportsSnapshot?.versions ?? []) : [];
  const automations = key === "agendamentos" || key === "entregas" || key === "relatorios-visao" ? await loadAutomations(context.supabase, context.agency.id) : undefined;
  const qrConnected = key === "agendamentos" ? await getQrStatus(context.agency.id).then(status => "state" in status && status.state === "connected", () => false) : false;
  const templates = key === "agendamentos" || key === "templates" || key === "relatorios-visao" ? await loadMessageTemplates(context.supabase, context.agency.id) : undefined;
  // The portfolio streams in after the page shell: each client reads its pre-computed period.
  const reportsGenerated = reportsSnapshot?.ready
    // eslint-disable-next-line react-hooks/purity -- request-time reference, computed once on the server
    ? reportsSnapshot.versions.filter(version => new Date(version.generatedAt).getTime() >= Date.now() - 30 * 86_400_000).length : null;
  const portfolio = key === "" ? <Suspense fallback={<PortfolioSkeleton />}>
    <Portfolio supabase={context.supabase} clients={clients} meta={metaSnapshot} reportsGenerated={reportsGenerated} />
  </Suspense> : undefined;
  return <DashboardWorkspace portfolio={portfolio} whatsapp={whatsapp} whatsappReadiness={key === "integracoes" ? whatsAppReadiness() : undefined} whatsappEmbedded={key === "integracoes" ? whatsAppEmbeddedSignup() : null} recipients={recipients} deliveries={deliveries} automations={automations} templates={templates} initialClientId={query.cliente} qrConnected={qrConnected} canSendReports={context.role !== "viewer"} key={context.agency.id} demo={false} section={key} clients={clients} initialMetaClientId={query.client} agencyId={context.agency.id} canEditClients={context.role !== "viewer"} canManageClientAccess={canManageClientAccess} clientPortalAdminReady={clientPortalAdminReady} portalAccesses={portalAccesses} portalInvitations={portalInvitations} metaSnapshot={metaSnapshot} reportsSnapshot={reportsSnapshot} activeClients={count ?? 0} identity={{ agencyName: context.agency.name, userName: context.user.email?.split("@")[0] ?? "Gestor", roleLabel: roleLabels[context.role], timezone: context.agency.timezone }} />;
}

async function Portfolio({ supabase, clients, meta, reportsGenerated }: { supabase: SupabaseClient<Database>; clients: ClientItem[]; meta: MetaAdminSnapshot | undefined; reportsGenerated: number | null }) {
  const rows = await loadPortfolioRows(supabase, clients, meta);
  return <PortfolioView base="/dashboard" summary={{ rows, reportsGenerated, periodLabel: "Últimos 30 dias" }} />;
}
