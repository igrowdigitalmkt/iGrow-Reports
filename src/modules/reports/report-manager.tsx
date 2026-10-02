"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Eye, Search, Send, Trash2, Download, CheckCircle2 } from "lucide-react";
import { downloadSavedReportPdf } from "./pdf-download";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import { deleteDashboardReport } from "@/modules/client-portal/report-actions";
import { publishReportVersion } from "./actions";
import type { AdminReportVersion, ReportsAdminSnapshot } from "./types";

export function ReportManager({ agencyId, clients, snapshot, canEdit }: {
  agencyId: string; clients: ClientItem[]; snapshot: ReportsAdminSnapshot; canEdit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const rows = useMemo(() => snapshot.versions.filter(version =>
    (clientFilter === "all" || version.clientId === clientFilter) &&
    (stateFilter === "all" || version.state === stateFilter) &&
    `${version.clientName} ${version.title} ${formatDate(version.dateFrom)} ${formatDate(version.dateTo)}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))
  ), [snapshot.versions, clientFilter, stateFilter, query]);
  function publish(id: string) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await publishReportVersion({ agencyId, reportVersionId: id });
      if ("error" in result) { setError(result.error ?? "Não foi possível concluir esta ação."); return; }
      setNotice("Relatório publicado. O cliente já pode visualizar e baixar o arquivo."); router.refresh();
    });
  }
  function remove(version: AdminReportVersion) {
    if (!window.confirm(`Excluir “${version.title}”? Ele deixará de ficar disponível para o cliente.`)) return;
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await deleteDashboardReport({ clientId: version.clientId, reportId: version.reportId });
      if ("error" in result) { setError(result.error ?? "Não foi possível concluir esta ação."); return; }
      setNotice("Relatório excluído."); router.refresh();
    });
  }
  if (!snapshot.ready) return <section className="panel empty-state"><FileText size={28} /><h3>Não foi possível carregar os relatórios</h3><p>Atualize a página para tentar novamente.</p></section>;
  return <div className="reports-management">
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>Relatórios</h2><p>Revise e gerencie os arquivos gerados na Visão geral de cada cliente.</p></div></div>
      <div className="reports-status-summary">
        <span><strong>{snapshot.versions.length}</strong> relatórios</span>
        <span><strong>{snapshot.versions.filter(v => v.state === "ready").length}</strong> não publicados</span>
        <span><strong>{snapshot.versions.filter(v => v.state === "published").length}</strong> disponíveis para o cliente</span>
      </div>
      <div className="reports-filter-grid">
        <label className="search-control !w-auto"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cliente, relatório ou período…" aria-label="Buscar relatório" /></label>
        <select className="input" value={clientFilter} onChange={event => setClientFilter(event.target.value)} aria-label="Filtrar por cliente"><option value="all">Todos os clientes</option>{clients.filter(c => !c.archived_at).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="input" value={stateFilter} onChange={event => setStateFilter(event.target.value)} aria-label="Filtrar por status"><option value="all">Todos os status</option><option value="ready">Não publicados</option><option value="published">Publicados</option><option value="superseded">Histórico</option></select>
      </div>
      <p className="reports-help">Publicado significa que o relatório está disponível na conta do cliente. Os demais ficam visíveis apenas para sua equipe.</p>
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-500">{notice}</p>}
    </section>
    <div className="reports-library">
      {rows.map(version => <article className="panel report-library-item" key={version.id}>
        <div className="report-library-info"><span className="reports-client-name">{version.clientName}</span><h3>{version.title}</h3><p>{formatDate(version.dateFrom)} a {formatDate(version.dateTo)}</p><small>Gerado em {formatDateTime(version.generatedAt)} · versão {version.versionNumber}</small></div>
        <div className="report-library-status"><span className={version.state === "published" ? "badge green" : version.state === "ready" ? "badge amber" : "badge neutral"}>{version.state === "published" ? "Publicado" : version.state === "ready" ? "Não publicado" : "Histórico"}</span><small>{version.state === "ready" ? "Somente sua equipe" : "Disponível para o cliente"}</small></div>
        <div className="report-library-actions">
          <Link className="button button-secondary button-sm" href={`/cliente/${version.clientId}/relatorios/${version.id}`}><Eye size={14} />Visualizar</Link>
          <Button className="button-sm" variant="secondary" disabled={pending} onClick={() => startTransition(async () => { setError(""); try { await downloadSavedReportPdf(version.clientId, version.id); } catch { setError("Não foi possível baixar o relatório. Tente novamente."); } })}><Download size={14} />Baixar PDF</Button>
          {canEdit && version.state === "ready" && <Button className="button-sm" onClick={() => publish(version.id)} disabled={pending}><Send size={14} />Publicar</Button>}
          {version.state === "published" && <span className="reports-published-note"><CheckCircle2 size={14} />Cliente pode visualizar</span>}
          {canEdit && <Button className="button-sm" variant="secondary" onClick={() => remove(version)} disabled={pending}><Trash2 size={14} />Excluir</Button>}
        </div>
      </article>)}
      {!rows.length && <section className="panel empty-state"><FileText size={28} /><h3>Nenhum relatório encontrado</h3><p>{snapshot.versions.length ? "Ajuste a busca ou os filtros." : "Os relatórios gerados na Visão geral aparecerão aqui."}</p></section>}
    </div>
  </div>;
}
function formatDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z")); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" }).format(new Date(value)); }
