"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { PortfolioView } from "./portfolio-view";
import { demoPortfolio } from "./demo-data";
import Link from "next/link";
import { useTheme } from "next-themes";
import { motion } from "motion/react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, CheckCheck, Clock3, FileChartColumn, Filter, Info, Monitor, Moon, Settings2, ShieldCheck, Sun, Users } from "lucide-react";
import { type WorkspaceIdentity, navigation, useWorkspaceSearch } from "@/components/layout/app-shell";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getDemoSnapshot } from "./demo-data";
import { emptySnapshot, type ReportRow } from "./dashboard-data";
import { ClientManager } from "@/modules/clients/client-manager";
import type { ClientItem } from "@/modules/clients/schema";
import type { ClientPortalAdminAccess, ClientPortalPendingInvitation } from "@/modules/client-portal/types";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import { ReportManager } from "@/modules/reports/report-manager";
import type { ReportsAdminSnapshot } from "@/modules/reports/types";
import { logoutAction } from "@/modules/auth/actions";
import type { WhatsAppSummary } from "@/modules/whatsapp/whatsapp-manager";
import { DeliveriesView, type DeliveryItem } from "@/modules/whatsapp/deliveries-view";
import { AutomationsView } from "@/modules/automations/automations-view";
import { IntegrationsHub } from "./integrations-hub";
import type { AutomationsSnapshot } from "@/modules/automations/types";
import type { TemplatesSnapshot } from "@/modules/templates/types";
import { TemplatesView } from "@/modules/templates/templates-view";
import { TeamView } from "@/modules/team/team-view";
import { ProfilePanel } from "@/modules/profile/profile-panel";
import type { TeamSnapshot } from "@/modules/team/admin";
import { demoTeam } from "@/modules/team/demo";
import type { AgencyRole } from "@/types/database";
import { isReportTab, SECTION_PATHS } from "./routes";
import { ReportTabs } from "./report-tabs";
import { ReportsOverview } from "./reports-overview";
import { demoAutomationClients, demoAutomationRecipients, demoAutomations } from "@/modules/automations/demo";
import type { SendableRecipient } from "@/modules/whatsapp/send-report-dialog";

interface Props { portfolio?: ReactNode; whatsapp?: WhatsAppSummary; whatsappReadiness?: { ready: boolean; missing: string[] }; whatsappEmbedded?: { configId: string; apiVersion: string } | null; recipients?: SendableRecipient[]; deliveries?: DeliveryItem[]; automations?: AutomationsSnapshot; templates?: TemplatesSnapshot; team?: TeamSnapshot; currentUserId?: string; currentRole?: AgencyRole; blocked?: boolean; initialClientId?: string; overviewPeriod?: "7d" | "30d" | "90d"; qrConnected?: boolean; canSendReports?: boolean; demo: boolean; section: string; identity: WorkspaceIdentity; activeClients?: number; clients?: ClientItem[]; initialMetaClientId?: string; agencyId?: string; canEditClients?: boolean; canManageClientAccess?: boolean; clientPortalAdminReady?: boolean; portalAccesses?: ClientPortalAdminAccess[]; portalInvitations?: ClientPortalPendingInvitation[]; metaSnapshot?: MetaAdminSnapshot; reportsSnapshot?: ReportsAdminSnapshot; }
const subscribeToHydration = () => () => {};

export function DashboardWorkspace({ portfolio, whatsapp = null, whatsappReadiness, whatsappEmbedded = null, recipients = [], deliveries = [], automations, templates, team, currentUserId = "", currentRole = "owner", blocked = false, initialClientId, overviewPeriod = "30d", qrConnected = false, canSendReports = false, demo, section, identity, activeClients = 0, clients, initialMetaClientId, agencyId, canEditClients = false, canManageClientAccess = false, clientPortalAdminReady = false, portalAccesses = [], portalInvitations = [], metaSnapshot, reportsSnapshot }: Props) {
  const { search } = useWorkspaceSearch();
  const [status, setStatus] = useState("Todos os estados");
  const [selectedReport, setSelectedReport] = useState<ReportRow | null>(null);
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const base = demo ? "/demo" : "/dashboard";
  const data = demo ? getDemoSnapshot("30d") : emptySnapshot(activeClients);
  const matchingReports = data.reports.filter(report => `${report.client} ${report.type} ${report.id}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")) && (status === "Todos os estados" || report.status === status));
  const reportTab = isReportTab(section);
  const currentLabel = reportTab ? "Relatórios" : navigation.find(item => item.key === (SECTION_PATHS[section] ?? section))?.label ?? "Visão geral";

  return <>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }}>
      <div className="page-heading"><div><h1>{currentLabel}</h1><p>{section ? sectionDescription(section) : `${identity.agencyName} · todo o trabalho com os clientes no período`}</p></div><div className="heading-actions">{!section && <nav className="segmented" aria-label="Período da visão geral">{([["7d", "7 dias"], ["30d", "30 dias"], ["90d", "90 dias"]] as const).map(([key, label]) => <Link key={key} href={key === "30d" ? base : `${base}?periodo=${key}`} aria-current={(demo ? "30d" : overviewPeriod) === key ? "page" : undefined} className="segmented-link" scroll={false}>{label}</Link>)}</nav>}</div></div>

      {blocked ? <section className="panel empty-state"><ShieldCheck size={22} /><h3>Área não liberada para você</h3><p>O acesso a esta área foi limitado por um proprietário ou administrador do espaço de trabalho. Peça a liberação em Equipe.</p></section> : <>
      {!section && (demo ? <PortfolioView summary={demoPortfolio} base={base} demo /> : portfolio)}

      {reportTab && <ReportTabs base={base} section={section} />}

      {section === "relatorios-visao" && <ReportsOverview base={base} automations={demo ? demoAutomations : automations ?? null} deliveries={demo ? [] : deliveries} clients={demo ? demoAutomationClients : clients ?? []} timezone={identity.timezone || "America/Sao_Paulo"} />}

      {section === "relatorios" && (demo ? <><div className="section-toolbar"><div className="flex items-center gap-2 muted text-sm"><Filter size={16} /><label className="sr-only" htmlFor="report-status">Filtrar relatórios por estado</label><select id="report-status" className="input compact-select" value={status} onChange={e => setStatus(e.target.value)}><option>Todos os estados</option><option>Entregue</option><option>Aguardando aprovação</option><option>Processando</option></select></div><span className="text-xs muted">Prévia com dados fictícios</span></div><ReportsTable rows={matchingReports} total={data.reports.length} demo={demo} base={base} onSelect={setSelectedReport} expanded /></> : agencyId && reportsSnapshot ? <ReportManager agencyId={agencyId} clients={clients ?? []} snapshot={reportsSnapshot} canEdit={canManageClientAccess} canSend={canSendReports} recipients={recipients} whatsAppReady={!!whatsapp?.templateName} /> : null)}

      {section === "clientes" && <ClientManager demo={demo} initialClients={clients} agencyId={agencyId} canEdit={canEditClients} canManageClientAccess={canManageClientAccess} clientPortalAdminReady={clientPortalAdminReady} portalAccesses={portalAccesses} portalInvitations={portalInvitations} metaSnapshot={metaSnapshot} search={search} />}

      {section === "integracoes" && <>
        <IntegrationsHub demo={demo} agencyId={agencyId} clients={clients ?? []} metaSnapshot={metaSnapshot} initialMetaClientId={initialMetaClientId} canManage={canManageClientAccess} whatsapp={whatsapp} whatsappReadiness={whatsappReadiness ?? { ready: false, missing: [] }} whatsappEmbedded={whatsappEmbedded} />
        <p className="footnote"><ShieldCheck size={15} />Chaves e tokens ficam só no servidor. Apenas proprietários e administradores podem alterá-los.</p>
      </>}

      {section === "configuracoes" && <div className="settings-grid"><ProfilePanel name={identity.userName} email={identity.email ?? (demo ? "silvio@igrow.com.br" : "")} avatarUrl={identity.avatarUrl ?? null} demo={demo} /><section className="panel settings-panel"><div className="panel-heading"><div><h2>Espaço de trabalho e acesso</h2><p>{demo ? "Contexto demonstrativo" : "Contexto autenticado da sua sessão"}</p></div><ShieldCheck size={18} className="muted" /></div><dl className="settings-fields"><div><dt>Espaço de trabalho</dt><dd>{identity.agencyName}</dd></div><div><dt>Usuário</dt><dd>{identity.userName}</dd></div><div><dt>Perfil</dt><dd>{identity.roleLabel}</dd></div><div><dt>Fuso horário</dt><dd className="font-mono text-sm">{identity.timezone}</dd></div></dl>{demo ? <Link className="button button-secondary" href="/entrar">Entrar no meu espaço<ArrowUpRight size={15} /></Link> : <div className="flex gap-3 flex-wrap"><Link className="button button-secondary" href="/selecionar-espaco">Trocar espaço de trabalho</Link><form action={logoutAction}><button className="button button-secondary" type="submit">Sair da conta</button></form></div>}</section><section className="panel settings-panel"><div className="panel-heading"><div><h2>Aparência</h2><p>Escolha como a plataforma aparece para você</p></div><Settings2 size={18} className="muted" /></div><div className="theme-options">{[{ key: "dark", label: "Escuro", Icon: Moon }, { key: "light", label: "Claro", Icon: Sun }, { key: "system", label: "Sistema", Icon: Monitor }].map(({ key, label, Icon }) => <button key={key} className={cn("theme-option", hydrated && theme === key && "selected")} onClick={() => setTheme(key)} aria-pressed={hydrated && theme === key}><Icon size={24} /><span>{label}</span></button>)}</div><p className="muted text-xs mt-5">Sua preferência fica salva neste navegador.</p></section></div>}

      {section === "entregas" && <DeliveriesView deliveries={demo ? [] : deliveries} automations={demo ? demoAutomations : automations ?? null} clients={demo ? demoAutomationClients : clients ?? []} connected={!!whatsapp || demo} timezone={identity.timezone || "America/Sao_Paulo"} initialClientId={initialClientId} />}

      {section === "templates" && <TemplatesView demo={demo} snapshot={demo ? { ready: true, channelsReady: true, items: [] } : templates ?? { ready: false, channelsReady: false, items: [] }} canEdit={demo || canSendReports} workspaceName={identity.agencyName} whatsapp={demo ? null : whatsapp} />}

      {section === "agendamentos" && demo && <AutomationsView demo snapshot={demoAutomations} clients={demoAutomationClients} recipients={demoAutomationRecipients} canEdit templates={[]} timezone="America/Sao_Paulo" workspaceName={identity.agencyName} appUrl={null} channelReady={false} />}
      {section === "agendamentos" && !demo && automations && <AutomationsView snapshot={automations} templates={templates?.items ?? []} initialClientId={initialClientId} clients={clients ?? []} recipients={recipients} canEdit={canSendReports} timezone={identity.timezone || "America/Sao_Paulo"} workspaceName={identity.agencyName} appUrl={process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? null} channelReady={qrConnected} />}

      {section === "equipe" && <TeamView snapshot={demo ? demoTeam : team ?? { ready: false, members: [], invitations: [] }} currentUserId={demo ? "demo-owner" : currentUserId} currentRole={demo ? "owner" : currentRole} timezone={identity.timezone || "America/Sao_Paulo"} demo={demo} />}
      </>}
    </motion.div>

    <Dialog open={!!selectedReport} onOpenChange={open => { if (!open) setSelectedReport(null); }} title={selectedReport?.client ?? "Relatório"} description="Prévia demonstrativa · todos os números abaixo são fictícios.">{selectedReport && <div><div className="report-preview-header"><span>{selectedReport.id} · v1</span><StatusBadge status={selectedReport.status} /></div><h3 className="text-lg font-semibold mt-6">{selectedReport.type}</h3><p className="muted text-sm mt-1">{selectedReport.date}</p><div className="preview-metrics"><div><small>Investimento fictício</small><strong>R$ 1.250,00</strong></div><div><small>{selectedReport.type === "Vendas" ? "Compras fictícias" : selectedReport.type === "Conversas" ? "Conversas fictícias" : "Leads fictícios"}</small><strong>50</strong></div><div><small>Custo por resultado</small><strong>R$ 25,00</strong></div></div><div className="info-banner mt-5"><Info size={18} /><p>Esta é uma amostra visual. Snapshots, aprovação, links de acesso e geração de PDF serão implementados nas próximas etapas.</p></div><div className="planned-note mt-5"><ArrowDownToLine size={15} />Download de PDF indisponível nesta etapa</div></div>}</Dialog>
  </>;
}

function StatusBadge({ status }: { status: ReportRow["status"] }) { return <span className={cn("badge", status === "Entregue" ? "green" : status === "Processando" ? "blue" : "amber")}>{status === "Entregue" ? <CheckCheck size={12} /> : status === "Processando" ? <Clock3 size={12} /> : <span className="status-dot" />}{status}</span>; }

function ReportsTable({ rows, total, demo, base, onSelect, expanded }: { rows: ReportRow[]; total: number; demo: boolean; base: string; onSelect: (row: ReportRow) => void; expanded?: boolean }) {
  return <section className="panel reports-panel"><div className="panel-heading"><div className="flex items-center gap-3"><h2>{expanded ? "Seus relatórios" : "Relatórios recentes"}</h2>{demo && <span className="badge neutral">Amostra · {total}</span>}</div>{!expanded && <Link className="text-link" href={`${base}/relatorios`}>Ver todos<ArrowRight size={14} /></Link>}</div>{rows.length ? <div className="table-scroll"><table className="reports-table"><caption className="sr-only">{demo ? "Relatórios fictícios para demonstração" : "Relatórios do espaço de trabalho"}</caption><thead><tr><th>Cliente</th><th>Período</th><th>Modelo</th><th>Estado da amostra</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{rows.map(report => <tr key={report.id}><td><div className="client-cell"><span className={cn("client-avatar", report.color)}>{report.initials}</span><div><strong>{report.client}</strong><small>{report.id} · v1</small></div></div></td><td className="mono-date">{report.date}</td><td><span className="template-label">{report.type}</span></td><td><StatusBadge status={report.status} /></td><td><button className="icon-button report-action" aria-label={`Visualizar relatório de ${report.client}`} onClick={() => onSelect(report)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div> : <EmptyState title={demo ? "Nenhum relatório encontrado" : "O primeiro relatório começa com seus dados"} description={demo ? "Ajuste a busca ou o filtro de estado para ver outros exemplos." : "A geração será liberada após o cadastro de clientes e a conexão com a Meta."} icon={FileChartColumn} />}</section>;
}

function EmptyState({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Users }) { return <div className="empty-state"><span><Icon size={26} strokeWidth={1.4} /></span><h3>{title}</h3><p>{description}</p></div>; }

function sectionDescription(section: string) {
  const descriptions: Record<string, string> = { clientes: "Clientes do espaço de trabalho e suas contas de anúncio.", "relatorios-visao": "Envios, entregas, templates e PDFs dos seus clientes.", relatorios: "Envios, entregas, templates e PDFs dos seus clientes.", templates: "Envios, entregas, templates e PDFs dos seus clientes.", agendamentos: "Mensagens com os números de cada cliente, enviadas no dia e horário que você escolher.", entregas: "Envios, entregas, templates e PDFs dos seus clientes.", integracoes: "Contas conectadas ao seu espaço de trabalho.", equipe: "Quem faz parte do espaço de trabalho e o que cada pessoa pode acessar.", configuracoes: "Sua conta, o espaço de trabalho e a aparência." };
  return descriptions[section];
}
