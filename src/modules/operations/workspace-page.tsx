import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadPortfolioRows, PORTFOLIO_PERIODS, portfolioPeriod, type PortfolioPeriod } from "@/modules/operations/portfolio-data";
import { PortfolioView } from "@/modules/operations/portfolio-view";
import { PortfolioSkeleton } from "@/modules/operations/portfolio-skeleton";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { googleAccountsByClient } from "@/modules/google-ads/provider";
import { canManageAgency, roleLabels } from "@/modules/agencies/roles";
import { DashboardWorkspace } from "@/modules/operations/dashboard-workspace";
import type { ClientItem } from "@/modules/clients/schema";
import { getAgencyClientPortalAccesses } from "@/modules/client-portal/admin";
import type { ClientPortalAdminAccess, ClientPortalPendingInvitation } from "@/modules/client-portal/types";
import { getMetaAdminSnapshot } from "@/modules/meta/admin";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import { getReportsAdminSnapshot } from "@/modules/reports/admin";

import { loadDeliveries, loadSendableRecipients, loadWhatsAppSummary } from "@/modules/whatsapp/admin";
import { whatsAppEmbeddedSignup, whatsAppReadiness } from "@/modules/whatsapp/server";
import { loadAutomations } from "@/modules/automations/admin";
import { getQrStatus } from "@/modules/whatsapp-qr/server";
import { loadMessageTemplates } from "@/modules/templates/admin";
import { loadOwnModules, loadTeam } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { legacyRedirect, SECTION_ROUTES } from "@/modules/operations/routes";

export type WorkspacePageProps = {
  searchParams: Promise<{ client?: string; clientId?: string; from?: string; to?: string; periodo?: string; cliente?: string }>;
};

export default async function WorkspacePage({
  section = [],
  searchParams,
}: WorkspacePageProps & { section?: string[] }) {
  const context = await requireAgencyContext();
  const query = await searchParams;
  const path = section.join("/");
  const legacy = legacyRedirect("", path, query);
  if (legacy) redirect(legacy);
  const key = SECTION_ROUTES[path];
  if (key === undefined) notFound();
  const canManageClientAccess = canManageAgency(context.role);
  const needsClients = key === "" || key === "clientes" || key === "relatorios" || key === "integracoes" || key === "entregas" || key === "agendamentos" || key === "templates" || key === "relatorios-visao";
  const agencyId = context.agency.id;
  // Tudo que a tela precisa e não depende de outra leitura sai junto (antes eram ~10 viagens ao banco em fila).
  // Member restrictions (Equipe › Permissões): a limited area shows a notice instead of its data.
  const ownModulesRead = context.role === "owner" || context.role === "admin" ? Promise.resolve(null) : loadOwnModules(context.supabase, agencyId, context.user.id);
  const clientCountRead = Promise.resolve(context.supabase.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).is("archived_at", null));
  const clientsRead = (async () => {
    const rows: ClientItem[] = [];
    if (!needsClients) return rows;
    for (let offset = 0; ; offset += 500) {
      const result = await context.supabase.from("clients").select("id,name,notes,archived_at,updated_at")
        .eq("agency_id", agencyId).order("name").order("id").range(offset, offset + 499);
      if (result.error) throw new Error("Não foi possível consultar os clientes.");
      rows.push(...result.data);
      if (result.data.length < 500) break;
    }
    return rows;
  })();
  const portalRead = key === "clientes" && canManageClientAccess ? getAgencyClientPortalAccesses(context.supabase, agencyId) : Promise.resolve(null);
  const metaRead = key === "" || key === "clientes" || key === "integracoes" ? getMetaAdminSnapshot(context.supabase, agencyId) : Promise.resolve(undefined);
  const reportsRead = key === "" || key === "relatorios" || key === "entregas" || key === "relatorios-visao" ? getReportsAdminSnapshot(context.supabase, agencyId) : Promise.resolve(undefined);
  const whatsappRead = key === "integracoes" || key === "relatorios" || key === "entregas" || key === "templates" || key === "agendamentos" || key === "whatsapp" ? loadWhatsAppSummary(context.supabase, agencyId) : Promise.resolve([] as Awaited<ReturnType<typeof loadWhatsAppSummary>>);
  const recipientsRead = key === "relatorios" || key === "agendamentos" || key === "whatsapp" ? loadSendableRecipients(context.supabase, agencyId) : Promise.resolve([] as Awaited<ReturnType<typeof loadSendableRecipients>>);
  const automationsRead = key === "agendamentos" || key === "entregas" || key === "relatorios-visao" ? loadAutomations(context.supabase, agencyId) : Promise.resolve(undefined);
  const qrRead = key === "agendamentos" ? getQrStatus(agencyId).then(status => "state" in status && status.state === "connected", () => false) : Promise.resolve(false);
  const teamRead = key === "equipe" ? loadTeam(context.supabase, agencyId, canManageAgency(context.role)) : Promise.resolve(undefined);
  const templatesRead = key === "agendamentos" || key === "templates" || key === "relatorios-visao" ? loadMessageTemplates(context.supabase, agencyId) : Promise.resolve(undefined);
  // Lista de Clientes: as contas do Google Ads vinculadas a cada cliente (só cadastro).
  const googleRead = key === "clientes" ? (async () => { const service = createSupabaseServiceClient(); return service ? await googleAccountsByClient(service, agencyId).catch(() => ({})) : {}; })() : Promise.resolve(undefined);
  const [ownModules, clientCount, clients, portalAdmin, metaSnapshot, reportsSnapshot, whatsapp, recipients, automations, qrConnected, team, templates, clientsGoogle] = await Promise.all([
    ownModulesRead, clientCountRead, clientsRead, portalRead, metaRead, reportsRead, whatsappRead, recipientsRead, automationsRead, qrRead, teamRead, templatesRead, googleRead,
  ]);
  const blocked = !canOpenSection(context.role, ownModules, key);
  if (clientCount.error) throw new Error("Não foi possível consultar os clientes deste espaço de trabalho.");
  const count = clientCount.count;
  const portalAccesses: ClientPortalAdminAccess[] = portalAdmin?.accesses ?? [];
  const portalInvitations: ClientPortalPendingInvitation[] = portalAdmin?.invitations ?? [];
  const clientPortalAdminReady = portalAdmin?.ready ?? false;
  // As entregas precisam dos clientes e dos relatórios já lidos.
  const deliveries = key === "entregas" || key === "relatorios-visao" ? await loadDeliveries(context.supabase, agencyId, clients, reportsSnapshot?.versions ?? []) : [];
  // The portfolio streams in after the page shell: each client reads its pre-computed period.
  const reportsGenerated = reportsSnapshot?.ready
    // eslint-disable-next-line react-hooks/purity -- request-time reference, computed once on the server
    ? reportsSnapshot.versions.filter(version => new Date(version.generatedAt).getTime() >= Date.now() - 30 * 86_400_000).length : null;
  const portfolio = key === "" ? <Suspense fallback={<PortfolioSkeleton />}>
    <Portfolio supabase={context.supabase} clients={clients} meta={metaSnapshot} reportsGenerated={reportsGenerated} period={portfolioPeriod(query.periodo)} aiAgencyId={context.role === "viewer" ? undefined : context.agency.id} agencyId={context.agency.id} />
  </Suspense> : undefined;
  return <DashboardWorkspace googleAccounts={clientsGoogle} portfolio={portfolio} whatsapp={whatsapp} whatsappReadiness={key === "integracoes" ? whatsAppReadiness() : undefined} whatsappEmbedded={key === "integracoes" ? whatsAppEmbeddedSignup() : null} recipients={recipients} deliveries={deliveries} automations={automations} team={team} currentUserId={context.user.id} currentRole={context.role} blocked={blocked} templates={templates} initialClientId={query.cliente} overviewPeriod={portfolioPeriod(query.periodo)} qrConnected={qrConnected} canSendReports={context.role !== "viewer"} key={context.agency.id} demo={false} section={key} clients={clients} initialMetaClientId={query.client} agencyId={context.agency.id} canEditClients={context.role !== "viewer"} canManageClientAccess={canManageClientAccess} clientPortalAdminReady={clientPortalAdminReady} portalAccesses={portalAccesses} portalInvitations={portalInvitations} metaSnapshot={metaSnapshot} reportsSnapshot={reportsSnapshot} activeClients={count ?? 0} identity={{ agencyName: context.agency.name, userName: (context.user.user_metadata as { full_name?: string } | undefined)?.full_name?.trim() || (context.user.email?.split("@")[0] ?? "Gestor"), roleLabel: roleLabels[context.role], timezone: context.agency.timezone, email: context.user.email ?? "", avatarUrl: (context.user.user_metadata as { avatar_url?: string } | undefined)?.avatar_url ?? null }} />;
}

async function Portfolio({ supabase, clients, meta, reportsGenerated, period, aiAgencyId, agencyId }: {
  /** Organização (para ler as contas do Google Ads vinculadas aos clientes). */ agencyId?: string; supabase: SupabaseClient<Database>; clients: ClientItem[]; meta: MetaAdminSnapshot | undefined; reportsGenerated: number | null; period: PortfolioPeriod; aiAgencyId?: string }) {
  const service = createSupabaseServiceClient();
  const google = service && agencyId ? await googleAccountsByClient(service, agencyId).catch(() => ({})) : {};
  const rows = await loadPortfolioRows(supabase, clients, meta, period, new Date(), google);
  return <PortfolioView base="" summary={{ rows, reportsGenerated, period, aiAgencyId, periodLabel: PORTFOLIO_PERIODS.find(item => item.key === period)?.label ?? "Últimos 30 dias" }} />;
}
