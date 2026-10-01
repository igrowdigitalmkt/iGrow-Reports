"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays, CheckCircle2, Clock3, Eye, Search, Send, Trash2, ExternalLink,
} from "lucide-react";
import { downloadSavedReportPdf } from "./pdf-download";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ClientItem } from "@/modules/clients/schema";
import { deleteDashboardReport } from "@/modules/client-portal/report-actions";
import { getAgencyReportPreview, publishReportVersion } from "./actions";
import type {
  AdminReportPreview, AdminReportVersion, ClientPortalReportMetric, ReportsAdminSnapshot,
} from "./types";

export function ReportManager({
  agencyId, clients, snapshot, canEdit,
}: {
  agencyId: string;
  clients: ClientItem[];
  snapshot: ReportsAdminSnapshot;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [viewing, setViewing] = useState<AdminReportVersion | null>(null);
  const [preview, setPreview] = useState<AdminReportPreview | null>(null);
  const [previewError, setPreviewError] = useState("");

  const activeClients = clients.filter((client) => !client.archived_at);
  const rows = useMemo(() => snapshot.versions.filter((version) => {
    if (clientFilter !== "all" && version.clientId !== clientFilter) return false;
    if (stateFilter !== "all" && version.state !== stateFilter) return false;
    const haystack = `${version.clientName} ${version.title} ${version.dateFrom} ${version.dateTo}`
      .toLocaleLowerCase("pt-BR");
    return haystack.includes(query.toLocaleLowerCase("pt-BR"));
  }), [snapshot.versions, clientFilter, stateFilter, query]);

  function viewReport(version: AdminReportVersion) {
    setViewing(version); setPreview(null); setPreviewError("");
    startTransition(async () => {
      const result = await getAgencyReportPreview(version.id);
      if ("error" in result) {
        setPreviewError(result.error ?? "Não foi possível carregar o relatório.");
        return;
      }
      setPreview(result.preview);
    });
  }
  function publish(reportVersionId: string) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await publishReportVersion({ agencyId, reportVersionId });
      if ("error" in result) {
        setError(result.error ?? "Não foi possível publicar o relatório.");
        return;
      }
      setNotice("Relatório publicado na Área do Cliente.");
      router.refresh();
    });
  }

  function remove(version: AdminReportVersion) {
    if (!window.confirm(`Excluir “${version.title}” e todas as versões deste relatório? O relatório deixará de ficar disponível para o cliente.`)) return;
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await deleteDashboardReport({ clientId: version.clientId, reportId: version.reportId });
      if ("error" in result) {
        setError(result.error ?? "Não foi possível excluir o relatório.");
        return;
      }
      setNotice("Relatório excluído.");
      router.refresh();
    });
  }

  if (!snapshot.ready) {
    return <section className="panel empty-state"><CalendarDays size={28} />
      <h3>Fundação de relatórios preparada</h3>
      <p>A estrutura de relatórios ainda precisa ser habilitada no banco de produção.</p>
    </section>;
  }
  return <div className="space-y-4">
    <section className="panel settings-panel">
      <div className="panel-heading"><div>
        <h2>Gerenciar relatórios</h2>
        <p>Os relatórios são gerados dentro do dashboard de cada cliente. Aqui você pesquisa, revisa, publica e exclui.</p>
      </div><span className="badge neutral">{snapshot.versions.length}</span></div>
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px_190px]">
        <label className="search-control !w-auto"><Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cliente ou relatório…" aria-label="Buscar relatório" />
        </label>
        <select className="input" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} aria-label="Filtrar por cliente">
          <option value="all">Todos os clientes</option>
          {activeClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <select className="input" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filtrar por estado">
          <option value="all">Todos os estados</option>
          <option value="ready">Pronto para publicar</option>
          <option value="published">Publicado</option>
          <option value="superseded">Histórico</option>
        </select>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-500">{notice}</p>}
    </section>
    <section className="panel reports-panel">
      <div className="panel-heading"><div><h2>Relatórios</h2><p>{rows.length} resultado(s) no filtro atual</p></div></div>
      {rows.length ? <div className="table-scroll"><table className="reports-table">
        <thead><tr><th>Cliente</th><th>Relatório</th><th>Período</th><th>Estado</th><th>Ações</th></tr></thead>
        <tbody>{rows.map((version) => <tr key={version.id}>
          <td><strong>{version.clientName}</strong></td>
          <td>{version.title} <span className="muted">· v{version.versionNumber}</span></td>
          <td>{formatDate(version.dateFrom)} – {formatDate(version.dateTo)}</td>
          <td><span className={version.state === "published" ? "badge green" : version.state === "ready" ? "badge amber" : "badge neutral"}>
            {version.state === "published" ? "Publicado" : version.state === "ready" ? "Pronto para publicar" : "Histórico"}
          </span></td>
          <td><div className="flex flex-wrap gap-2">
            <Button className="button-sm" variant="secondary" onClick={() => viewReport(version)} disabled={pending}>
              <Eye size={13} />Visualizar
            </Button>
            <Button className="button-sm" variant="secondary" disabled={pending} onClick={() => startTransition(async () => {
              try { await downloadSavedReportPdf(version.clientId, version.id); } catch { setError("Não foi possível baixar o PDF."); }
            })}>PDF</Button>
            <Link className="button button-secondary button-sm" href={`/cliente/${version.clientId}`}>
              <ExternalLink size={13} />Abrir cliente
            </Link>
            {version.state === "ready" && canEdit
              ? <Button className="button-sm" onClick={() => publish(version.id)} disabled={pending}><Send size={13} />Publicar</Button>
              : version.state === "published"
                ? <span className="planned-note"><CheckCircle2 size={14} />Disponível</span>
                : <span className="planned-note"><Clock3 size={14} />Histórico</span>}
            {canEdit && <Button className="button-sm" variant="secondary" onClick={() => remove(version)} disabled={pending}>
              <Trash2 size={13} />Excluir
            </Button>}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state"><CalendarDays size={26} />
        <h3>Nenhum relatório encontrado</h3>
        <p>Ajuste os filtros ou abra o dashboard de um cliente para gerar um relatório.</p>
      </div>}
    </section>

    <Dialog open={!!viewing} onOpenChange={(open) => { if (!open) setViewing(null); }}
      title={viewing ? `${viewing.title} · v${viewing.versionNumber}` : "Relatório"} description={viewing?.clientName}>
      {previewError ? <p role="alert" className="text-sm text-rose-400">{previewError}</p>
        : !preview ? <p role="status">Carregando relatório…</p> : <>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="badge neutral">{preview.state === "ready" ? "Prévia · pronto para publicar" : preview.state === "published" ? "Publicado" : "Histórico"}</span>
          <span className="muted text-sm">{formatDate(preview.dateFrom)} – {formatDate(preview.dateTo)}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {preview.metrics.map((metric) => <div className="report-preview-metric" key={metric.metricKey}>
            <p>{metric.label}</p><strong>{formatPreviewMetric(metric, preview.currency)}</strong>
          </div>)}
        </div>
        {!preview.metrics.length && <p>Esta versão não possui indicadores disponíveis.</p>}
        <p className="muted mt-5 text-sm">Valores preservados nesta versão. Novas coletas não alteram este relatório.</p>
        {viewing && <div className="mt-4"><Link className="text-link"
          href={`/cliente/${viewing.clientId}?periodo=custom&from=${preview.dateFrom}&to=${preview.dateTo}`}>
          Explorar dashboard do cliente
        </Link></div>}
      </>}
    </Dialog>
  </div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(value + "T12:00:00Z"));
}
function formatPreviewMetric(metric: ClientPortalReportMetric, currency: string | null) {
  if (metric.numericValue === null || !Number.isFinite(Number(metric.numericValue))) return "Indisponível";
  const value = Number(metric.numericValue);
  if (metric.unit === "currency" && !currency) return "Indisponível";
  const formatted = new Intl.NumberFormat("pt-BR", {
    ...(metric.unit === "currency" ? { style: "currency", currency: currency! } : {}),
    minimumFractionDigits: metric.unit === "integer" ? 0 : metric.displayPrecision,
    maximumFractionDigits: metric.unit === "integer" ? 0 : metric.displayPrecision,
  }).format(value);
  return metric.unit === "percent" ? `${formatted}%` : metric.unit === "ratio" ? `${formatted}×` : formatted;
}
