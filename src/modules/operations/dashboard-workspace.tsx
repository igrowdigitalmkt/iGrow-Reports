"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { motion } from "motion/react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, ChevronRight, Clock3, FileChartColumn, Filter, Info, MailCheck, Monitor, Moon, Plug, Radio, Send, Settings2, ShieldCheck, Sparkles, Sun, Users } from "lucide-react";
import { AppShell, type WorkspaceIdentity, navigation } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { demoClients, getDemoSnapshot } from "./demo-data";
import { deliveryRate, emptySnapshot, type DashboardPeriod, type DashboardSnapshot, type ReportRow } from "./dashboard-data";
import { ClientManager } from "@/modules/clients/client-manager";
import type { ClientItem } from "@/modules/clients/schema";
import type { ClientPortalAdminAccess } from "@/modules/client-portal/types";
import { MetaIntegrationManager } from "@/modules/meta/integration-manager";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import { ReportManager } from "@/modules/reports/report-manager";
import type { ReportsAdminSnapshot } from "@/modules/reports/types";
import { OnboardingChecklist } from "./onboarding-checklist";
import { logoutAction } from "@/modules/auth/actions";

const ActivityChart = dynamic(() => import("@/components/charts/activity-chart"), { ssr: false, loading: () => <div className="activity-chart skeleton" aria-label="Carregando gráfico" /> });

interface Props { referenceTime?: number; analyzedClientIds?: string[]; demo: boolean; section: string; identity: WorkspaceIdentity; activeClients?: number; clients?: ClientItem[]; initialMetaClientId?: string; agencyId?: string; canEditClients?: boolean; canManageClientAccess?: boolean; clientPortalAdminReady?: boolean; portalAccesses?: ClientPortalAdminAccess[]; metaSnapshot?: MetaAdminSnapshot; reportsSnapshot?: ReportsAdminSnapshot; }
const number = (value: number | null) => value === null ? "—" : value.toLocaleString("pt-BR");
const subscribeToHydration = () => () => {};

export function DashboardWorkspace({ referenceTime = 0, analyzedClientIds = [], demo, section, identity, activeClients = 0, clients, initialMetaClientId, agencyId, canEditClients = false, canManageClientAccess = false, clientPortalAdminReady = false, portalAccesses = [], metaSnapshot, reportsSnapshot }: Props) {
  const [period, setPeriod] = useState<DashboardPeriod>("30d");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Todos os estados");
  const [selectedReport, setSelectedReport] = useState<ReportRow | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const base = demo ? "/demo" : "/dashboard";
  const data = demo ? getDemoSnapshot(period) : emptySnapshot(activeClients);
  const connected = (metaSnapshot?.links.some(link => link.active) ?? false);
  if (!demo && reportsSnapshot?.ready) data.reportsGenerated = reportsSnapshot.versions.filter(version => new Date(version.generatedAt).getTime() >= referenceTime - (period === "7d" ? 7 : 30) * 86400000).length;
  const matchingReports = data.reports.filter(report => `${report.client} ${report.type} ${report.id}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")) && (status === "Todos os estados" || report.status === status));
  const currentLabel = navigation.find(item => item.key === section)?.label ?? "Dashboard";

  return <AppShell demo={demo} identity={identity} search={search} onSearch={setSearch}>
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>
      <div className="page-heading"><div><div className="eyebrow"><span className="tiny-line" /> {section ? "SEU ESPAÇO DE TRABALHO" : "VISÃO GERAL DA OPERAÇÃO"}</div><h1>{section ? currentLabel : `Olá, ${identity.userName.split(/[ @.]+/)[0]}.`}<span className="heading-dot">{section ? "" : " ✦"}</span></h1><p>{section ? sectionDescription(section) : "Tudo o que importa para seus relatórios, em um só lugar."}</p></div><div className="heading-actions">{!section && <><label className="period-select"><CalendarDays size={16} /><select aria-label="Período do dashboard" value={period} onChange={event => setPeriod(event.target.value as DashboardPeriod)}><option value="30d">Últimos 30 dias</option><option value="7d">Últimos 7 dias</option></select></label><Button asChild><Link href={`${base}/relatorios`}><FileChartColumn size={16} />Ver relatórios<ArrowUpRight size={15} /></Link></Button></>}</div></div>

      {!section && <>
        {!demo && agencyId && canEditClients && <OnboardingChecklist workspaceId={agencyId} clients={clients ?? []} meta={metaSnapshot} reports={reportsSnapshot} analyzedClientIds={analyzedClientIds} />}
        <div className="operation-strip"><div><span className={cn("pulse-icon", demo ? "cyan" : "amber")}><Radio size={16} /></span><strong>{demo ? "Sua operação, em perspectiva" : connected ? "Sua operação está conectada" : "Vamos preparar sua operação"}</strong><span className="operation-caption">{demo ? "Explore um cenário fictício da plataforma" : connected ? "Abra um cliente para analisar seus dados atuais" : "Vincule as contas de um cliente para começar"}</span></div><Link href={`${base}/integracoes`}>{demo ? "Integrações simuladas" : connected ? "Gerenciar integrações" : "Configurar integrações"}<ChevronRight size={15} /></Link></div>
        <div className="stats-grid">
          <Metric title="Clientes ativos" value={number(data.activeClients)} icon={Users} color="blue" note={demo ? "6 marcas no cenário demonstrativo" : "Clientes não arquivados do espaço de trabalho"} detail="Total de clientes não arquivados no espaço de trabalho selecionado." onInfo={setDetail} />
          <Metric title="Relatórios gerados" value={number(data.reportsGenerated)} icon={FileChartColumn} color="violet" note={demo ? "Versões concluídas no período" : "Versões geradas no período"} detail="Quantidade de versões de relatório concluídas no intervalo. Um relatório pode ter várias entregas." onInfo={setDetail} />
          <Metric title="Taxa de entrega" value={data.accepted === null ? "—" : deliveryRate(data.accepted, data.delivered)} icon={MailCheck} color="cyan" note={data.accepted === null ? "Sem dados de mensagens" : `${data.delivered} entregues de ${data.accepted} aceitas`} detail="Entregas confirmadas divididas por envios aceitos da mesma coorte e período. Aceite pelo provedor não confirma entrega." onInfo={setDetail} />
          <Metric title="Próximos envios" value={number(data.upcoming)} icon={CalendarDays} color="amber" note={demo ? "Previstos nas próximas 24 horas" : "Agendamentos ainda não disponíveis"} detail="Ocorrências previstas no horizonte de 24 horas após a referência do cenário. O envio depende das integrações e da aprovação." onInfo={setDetail} />
        </div>
        <div className="overview-grid"><section className="panel activity-panel"><div className="panel-heading"><div><h2>Atividade dos relatórios</h2><p>{demo ? `${period === "7d" ? "24" : "01"} – 30 de setembro de 2026 · dados fictícios` : "Acompanhe a geração e a comunicação ao longo do tempo"}</p></div><button className="icon-button" aria-label="Sobre o gráfico de atividade" onClick={() => setDetail("Cada série tem uma unidade: versões de relatórios geradas e mensagens entregues. As séries não representam um funil. Consulte a tabela abaixo do gráfico para os valores diários.")}><Info size={16} /></button></div><div className="chart-legend"><span><i className="legend-dot violet" />Relatórios gerados<strong>{number(data.reportsGenerated)}</strong></span><span><i className="legend-dot cyan" />Mensagens entregues<strong>{number(data.delivered)}</strong></span></div>{demo ? <ActivityChart data={data} /> : <EmptyState title="Sua história começa aqui" description="A atividade aparecerá quando a geração e as integrações estiverem disponíveis." icon={ChartIcon} />}</section>
        <section className="panel upcoming-panel"><div className="panel-heading"><div><h2>Próximos envios</h2><p>{demo ? "01 de outubro · horários fictícios" : "Agenda do seu espaço de trabalho"}</p></div><span className="badge neutral">24h</span></div>{demo ? <><div className="timeline">{demoClients.slice(0, 4).map((client, index) => <div className="timeline-item" key={client.name}><span className="timeline-point" /><div><span className="timeline-time">{index < 2 ? "09:00" : index === 2 ? "10:30" : "14:00"}<span> · {identity.timezone.replace("America/", "").replace("_", " ")}</span></span><strong>{client.name}</strong><small>Relatório semanal <span>· 2 destinatários</span></small></div><ChevronRight size={14} /></div>)}</div><Link className="panel-footer-link" href={`${base}/agendamentos`}>Ver todos os agendamentos<ArrowRight size={14} /></Link></> : <EmptyState title="Nenhum envio programado" description="Os agendamentos serão liberados após as integrações." icon={CalendarDays} />}</section></div>
        {demo ? <ReportsTable rows={matchingReports} total={data.reports.length} demo={demo} base={base} onSelect={setSelectedReport} /> : <section className="panel"><div className="panel-heading"><div><h2>Seus relatórios</h2><p>{reportsSnapshot?.versions.length ?? 0} versões salvas · rascunhos e publicados</p></div><Link className="button button-secondary" href="/dashboard/relatorios">Gerenciar relatórios<ArrowRight size={15} /></Link></div></section>}
        <div className="bottom-grid"><Communication data={data} demo={demo} onInfo={setDetail} /><section className="panel integrations-summary"><div className="panel-heading"><div><h2>Suas integrações</h2><p>A base de uma operação conectada</p></div><Plug size={17} className="muted" /></div><div className="integration-row"><span className="provider-logo meta-logo">∞</span><div><strong>Meta Ads</strong><small>Contas e dados de campanhas</small></div><span className={cn("badge", demo ? "blue" : "neutral")}>{demo ? "Simulada" : connected ? "Conectada" : "Não configurada"}</span></div><div className="integration-row"><span className="provider-logo whatsapp-logo"><Send size={20} /></span><div><strong>WhatsApp Business</strong><small>Cloud API oficial</small></div><span className={cn("badge", demo ? "blue" : "neutral")}>{demo ? "Simulada" : "Não configurada"}</span></div><Link className="panel-footer-link" href={`${base}/integracoes`}>Gerenciar integrações<ArrowRight size={14} /></Link></section></div>
      </>}

      {section === "relatorios" && (demo ? <><div className="section-toolbar"><div className="flex items-center gap-2 muted text-sm"><Filter size={16} /><label className="sr-only" htmlFor="report-status">Filtrar relatórios por estado</label><select id="report-status" className="input compact-select" value={status} onChange={e => setStatus(e.target.value)}><option>Todos os estados</option><option>Entregue</option><option>Aguardando aprovação</option><option>Processando</option></select></div><span className="text-xs muted">Prévia com dados fictícios</span></div><ReportsTable rows={matchingReports} total={data.reports.length} demo={demo} base={base} onSelect={setSelectedReport} expanded /></> : agencyId && reportsSnapshot ? <ReportManager agencyId={agencyId} clients={clients ?? []} snapshot={reportsSnapshot} canEdit={canManageClientAccess} /> : null)}

      {section === "clientes" && <ClientManager demo={demo} initialClients={clients} agencyId={agencyId} canEdit={canEditClients} canManageClientAccess={canManageClientAccess} clientPortalAdminReady={clientPortalAdminReady} portalAccesses={portalAccesses} metaSnapshot={metaSnapshot} search={search} />}

      {section === "integracoes" && <>
        <div className="info-banner"><ShieldCheck size={19} /><p>Credenciais externas são processadas somente no servidor. Proprietários e administradores gerenciam segredos; editores podem configurar clientes e atualizar dados quando a integração estiver pronta.</p></div>
        <div className="integration-cards">
          {!demo && agencyId && metaSnapshot ? (
            <MetaIntegrationManager agencyId={agencyId} clients={(clients ?? []).filter((client) => !client.archived_at)} initialClientId={initialMetaClientId} snapshot={metaSnapshot} canManage={canManageClientAccess} />
          ) : (
            <section className="panel integration-card">
              <span className="provider-large blue">∞</span>
              <span className="badge neutral mt-6">{demo ? "Simulada" : "Não configurada"}</span>
              <h2>Meta Ads</h2>
              <span className="eyebrow text-[11px]">MARKETING API</span>
              <p>Contas de anúncios, campanhas e dados de performance em um único fluxo.</p>
              <div className="planned-note"><Clock3 size={15} />{demo ? "Integração simulada no ambiente demonstrativo" : "Aguardando configuração"}</div>
            </section>
          )}
          {[{ name: "WhatsApp Business", label: "Cloud API oficial", icon: "↗", description: "Relatórios entregues aos destinatários com autorização de recebimento.", color: "green" }, { name: "Upstash QStash", label: "Jobs e agendamentos", icon: "ϟ", description: "Execuções em etapas, com tentativas controladas e rastreabilidade.", color: "violet" }].map(provider => <section className="panel integration-card" key={provider.name}><span className={cn("provider-large", provider.color)}>{provider.icon}</span><span className="badge neutral mt-6">Não configurada</span><h2>{provider.name}</h2><span className="eyebrow text-[11px]">{provider.label}</span><p>{provider.description}</p><div className="planned-note"><Clock3 size={15} />Implementação em etapa futura</div></section>)}
        </div>
      </>}

      {section === "configuracoes" && <div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><h2>Espaço de trabalho e acesso</h2><p>{demo ? "Contexto demonstrativo" : "Contexto autenticado da sua sessão"}</p></div><ShieldCheck size={18} className="muted" /></div><dl className="settings-fields"><div><dt>Espaço de trabalho</dt><dd>{identity.agencyName}</dd></div><div><dt>Usuário</dt><dd>{identity.userName}</dd></div><div><dt>Perfil</dt><dd>{identity.roleLabel}</dd></div><div><dt>Fuso horário</dt><dd className="font-mono text-sm">{identity.timezone}</dd></div></dl>{demo ? <Link className="button button-secondary" href="/entrar">Entrar no meu espaço<ArrowUpRight size={15} /></Link> : <div className="flex gap-3 flex-wrap"><Link className="button button-secondary" href="/selecionar-agencia">Trocar espaço de trabalho</Link><form action={logoutAction}><button className="button button-secondary" type="submit">Sair da conta</button></form></div>}</section><section className="panel settings-panel"><div className="panel-heading"><div><h2>Aparência</h2><p>Escolha como a plataforma aparece para você</p></div><Settings2 size={18} className="muted" /></div><div className="theme-options">{[{ key: "dark", label: "Escuro", Icon: Moon }, { key: "light", label: "Claro", Icon: Sun }, { key: "system", label: "Sistema", Icon: Monitor }].map(({ key, label, Icon }) => <button key={key} className={cn("theme-option", hydrated && theme === key && "selected")} onClick={() => setTheme(key)} aria-pressed={hydrated && theme === key}><Icon size={24} /><span>{label}</span></button>)}</div><p className="muted text-xs mt-5">Sua preferência fica salva neste navegador.</p></section></div>}

      {["templates", "agendamentos", "entregas"].includes(section) && <section className="panel feature-preview"><span className="feature-icon">{section === "templates" ? <FileChartColumn size={30} /> : section === "agendamentos" ? <CalendarDays size={30} /> : <Send size={30} />}</span><span className="badge violet">Próxima etapa</span><h2>{section === "templates" ? "Relatórios com a sua visão." : section === "agendamentos" ? "Uma rotina que trabalha com você." : "Cada entrega, acompanhada."}</h2><p>{section === "templates" ? "Os modelos de captação, conversas e vendas terão blocos configuráveis e versões preservadas." : section === "agendamentos" ? "A recorrência, o fuso e as próximas ocorrências serão controlados pelo espaço de trabalho, com execução pelo QStash." : "Acompanhe o aceite, a entrega e a leitura de cada mensagem pela WhatsApp Cloud API oficial."}</p><div className="planned-note"><Info size={16} />Esta funcionalidade ainda não está disponível.</div><Link className="button button-secondary mt-7" href={base}>Voltar ao dashboard<ArrowRight size={15} /></Link></section>}
    </motion.div>

    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }} title="Entenda este indicador" description={demo ? "Informações do cenário demonstrativo." : "Definição do indicador operacional."}><p className="text-sm leading-7 muted">{detail}</p></Dialog>
    <Dialog open={!!selectedReport} onOpenChange={open => { if (!open) setSelectedReport(null); }} title={selectedReport?.client ?? "Relatório"} description="Prévia demonstrativa · todos os números abaixo são fictícios.">{selectedReport && <div><div className="report-preview-header"><span>{selectedReport.id} · v1</span><StatusBadge status={selectedReport.status} /></div><h3 className="text-lg font-semibold mt-6">{selectedReport.type}</h3><p className="muted text-sm mt-1">{selectedReport.date}</p><div className="preview-metrics"><div><small>Investimento fictício</small><strong>R$ 1.250,00</strong></div><div><small>{selectedReport.type === "Vendas" ? "Compras fictícias" : selectedReport.type === "Conversas" ? "Conversas fictícias" : "Leads fictícios"}</small><strong>50</strong></div><div><small>Custo por resultado</small><strong>R$ 25,00</strong></div></div><div className="info-banner mt-5"><Info size={18} /><p>Esta é uma amostra visual. Snapshots, aprovação, links de acesso e geração de PDF serão implementados nas próximas etapas.</p></div><div className="planned-note mt-5"><ArrowDownToLine size={15} />Download de PDF indisponível nesta etapa</div></div>}</Dialog>
  </AppShell>;
}

function Metric({ title, value, icon: Icon, color, note, detail, onInfo }: { title: string; value: string; icon: typeof Users; color: string; note: string; detail: string; onInfo: (detail: string) => void }) {
  return <section className="panel metric-card"><div className="metric-label"><span>{title}</span><span className={cn("metric-icon", color)}><Icon size={18} strokeWidth={1.7} /></span></div><strong className="metric-value">{value}</strong><div className="metric-note"><span>{note}</span><button aria-label={`Como calculamos: ${title}`} onClick={() => onInfo(detail)}><Info size={13} /></button></div></section>;
}

function StatusBadge({ status }: { status: ReportRow["status"] }) { return <span className={cn("badge", status === "Entregue" ? "green" : status === "Processando" ? "blue" : "amber")}>{status === "Entregue" ? <CheckCheck size={12} /> : status === "Processando" ? <Clock3 size={12} /> : <span className="status-dot" />}{status}</span>; }

function ReportsTable({ rows, total, demo, base, onSelect, expanded }: { rows: ReportRow[]; total: number; demo: boolean; base: string; onSelect: (row: ReportRow) => void; expanded?: boolean }) {
  return <section className="panel reports-panel"><div className="panel-heading"><div className="flex items-center gap-3"><h2>{expanded ? "Seus relatórios" : "Relatórios recentes"}</h2>{demo && <span className="badge neutral">Amostra · {total}</span>}</div>{!expanded && <Link className="text-link" href={`${base}/relatorios`}>Ver todos<ArrowRight size={14} /></Link>}</div>{rows.length ? <div className="table-scroll"><table className="reports-table"><caption className="sr-only">{demo ? "Relatórios fictícios para demonstração" : "Relatórios do espaço de trabalho"}</caption><thead><tr><th>Cliente</th><th>Período</th><th>Modelo</th><th>Estado da amostra</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{rows.map(report => <tr key={report.id}><td><div className="client-cell"><span className={cn("client-avatar", report.color)}>{report.initials}</span><div><strong>{report.client}</strong><small>{report.id} · v1</small></div></div></td><td className="mono-date">{report.date}</td><td><span className="template-label">{report.type}</span></td><td><StatusBadge status={report.status} /></td><td><button className="icon-button report-action" aria-label={`Visualizar relatório de ${report.client}`} onClick={() => onSelect(report)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div> : <EmptyState title={demo ? "Nenhum relatório encontrado" : "O primeiro relatório começa com seus dados"} description={demo ? "Ajuste a busca ou o filtro de estado para ver outros exemplos." : "A geração será liberada após o cadastro de clientes e a conexão com a Meta."} icon={FileChartColumn} />}</section>;
}

function Communication({ data, demo, onInfo }: { data: DashboardSnapshot; demo: boolean; onInfo: (value: string) => void }) {
  const items = [{ label: "Aceitas", value: data.accepted, color: "blue", Icon: Send }, { label: "Entregues", value: data.delivered, color: "cyan", Icon: CheckCheck }, { label: "Lidas", value: data.read, color: "violet", Icon: MailCheck }, { label: "Com acesso", value: data.accessed, color: "green", Icon: ArrowUpRight }];
  return <section className="panel communication-panel"><div className="panel-heading"><div><h2>Além do envio</h2><p>Indicadores de comunicação da mesma coorte</p></div><button className="icon-button" aria-label="Sobre os indicadores de comunicação" onClick={() => onInfo("As contagens usam as mesmas mensagens aceitas no período. Leitura depende da confirmação do WhatsApp. Acesso identifica o link atribuído, sem comprovar a identidade de quem o abriu. Acesso e leitura podem ocorrer em ordens diferentes.")}><Info size={16} /></button></div><div className="communication-grid">{items.map(({ label, value, color, Icon }) => <div key={label}><span className={cn("communication-icon", color)}><Icon size={16} /></span><strong>{number(value)}</strong><span>{label}</span><div className="mini-track"><i className={color} style={{ width: `${data.accepted && value ? value / data.accepted * 100 : 0}%` }} /></div></div>)}</div><p className="communication-footnote"><Info size={12} />{demo ? "Cenário fictício. Acesso e leitura são eventos independentes." : "Sem dados. Aguardando a implementação das integrações."}</p></section>;
}

const ChartIcon = Sparkles;
function EmptyState({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Users }) { return <div className="empty-state"><span><Icon size={26} strokeWidth={1.4} /></span><h3>{title}</h3><p>{description}</p></div>; }

function sectionDescription(section: string) {
  const descriptions: Record<string, string> = { clientes: "Cada cliente, seus objetivos e uma visão organizada.", relatorios: "Acompanhe cada versão e transforme dados em clareza.", templates: "Uma estrutura consistente para contar boas histórias.", agendamentos: "Organize a próxima conversa com seus clientes.", entregas: "Visibilidade sobre cada mensagem, do envio ao acesso.", integracoes: "Conecte as ferramentas que movem sua operação.", configuracoes: "Seu espaço de trabalho, do seu jeito." };
  return descriptions[section];
}
