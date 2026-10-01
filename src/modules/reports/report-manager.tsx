"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, CheckCircle2, FilePlus2, Send, Clock3, GitBranchPlus, X, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { AnalyticsPeriod } from "@/modules/client-portal/range";
import type { ClientItem } from "@/modules/clients/schema";
import { generateManualReport, getAgencyReportPreview, publishReportVersion } from "./actions";
import type { AdminReportPreview, AdminReportVersion, ClientPortalReportMetric, ReportsAdminSnapshot } from "./types";

export function ReportManager({
  agencyId,
  clients,
  snapshot,
  canEdit,
  initialRange,
}: {
  agencyId: string;
  clients: ClientItem[];
  snapshot: ReportsAdminSnapshot;
  canEdit: boolean;
  initialRange?: { clientId?: string; from?: string; to?: string; periodo?: string };
}) {
  const router = useRouter();
  const activeClients = clients.filter((client) => !client.archived_at);
  const [clientId, setClientId] = useState(activeClients.find(client => client.id === initialRange?.clientId)?.id ?? activeClients[0]?.id ?? "");
  const [period, setPeriod] = useState<AnalyticsPeriod>(initialRange?.from && initialRange?.to ? "custom" : "30d");
  const [from, setFrom] = useState(initialRange?.from ?? "");
  const [to, setTo] = useState(initialRange?.to ?? "");
  const [title, setTitle] = useState("Relatório de performance");
  const [reportId, setReportId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [viewing, setViewing] = useState<AdminReportVersion | null>(null);
  const [preview, setPreview] = useState<AdminReportPreview | null>(null);
  const [previewError, setPreviewError] = useState("");

  function viewReport(version: AdminReportVersion) {
    setViewing(version); setPreview(null); setPreviewError("");
    startTransition(async () => {
      const result = await getAgencyReportPreview(version.id);
      if ("error" in result) { setPreviewError(result.error); return; }
      setPreview(result.preview);
    });
  }

  function generate() {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await generateManualReport({ agencyId, clientId, period, from, to, title, reportId });
      if ("error" in result) { setError(result.error); return; }
      const baseNotice = reportId
        ? "Nova versão gerada. Revise e publique quando estiver pronta."
        : "Versão gerada. Revise e publique quando estiver pronta.";
      setNotice(result.warning ? `${baseNotice} ${result.warning}` : baseNotice);
      setReportId(null);
      router.refresh();
    });
  }

  function startRevision(version: ReportsAdminSnapshot["versions"][number]) {
    setClientId(version.clientId);
    setTitle(version.title);
    setReportId(version.reportId);
    setError("");
    setNotice(`Preparando nova versão de ${version.title}. Escolha o período e gere o snapshot.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function publish(reportVersionId: string) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await publishReportVersion({ agencyId, reportVersionId });
      if ("error" in result) { setError(result.error); return; }
      setNotice("Relatório publicado na Área do Cliente.");
      router.refresh();
    });
  }

  if (!snapshot.ready) {
    return <section className="panel empty-state"><FilePlus2 size={28} /><h3>Fundação de relatórios preparada</h3><p>A interface já está pronta, mas a migration de relatórios ainda precisa ser habilitada no banco de produção.</p></section>;
  }

  return <div className="space-y-4">
    {canEdit && <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>{reportId ? "Gerar nova versão" : "Gerar relatório"}</h2><p>{reportId ? "A nova versão preservará todas as versões publicadas anteriormente." : "Crie um snapshot imutável a partir dos dados já coletados."}</p></div>{reportId ? <button className="icon-button" type="button" aria-label="Cancelar nova versão" onClick={() => setReportId(null)}><X size={16} /></button> : <FilePlus2 size={18} className="muted" />}</div>
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px_1fr_auto]">
        <select className="input" value={clientId} onChange={e => setClientId(e.target.value)} aria-label="Cliente" disabled={!!reportId}>
          {activeClients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <select className="input" value={period} onChange={e => setPeriod(e.target.value as AnalyticsPeriod)} aria-label="Período">
          <option value="7d">7 dias completos</option><option value="30d">30 dias completos</option><option value="90d">90 dias</option><option value="180d">6 meses</option><option value="365d">1 ano</option><option value="custom">Personalizado</option>
        </select>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} aria-label="Título" disabled={!!reportId} />
        <Button onClick={generate} disabled={pending || !clientId || title.trim().length < 2}><FilePlus2 size={15} />{pending ? "Gerando…" : reportId ? "Gerar versão" : "Gerar"}</Button>
      </div>
      {period === "custom" && <div className="mt-3 flex flex-wrap gap-3"><label className="text-sm">De<input className="input mt-1" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="text-sm">Até<input className="input mt-1" type="date" value={to} onChange={e => setTo(e.target.value)} /></label><p className="muted text-sm self-end">Resumo de todas as contas associadas ao cliente.</p></div>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-500">{notice}</p>}
    </section>}

    <section className="panel reports-panel">
      <div className="panel-heading"><div><h2>Versões de relatórios</h2><p>Snapshots preservados por cliente e período</p></div><span className="badge neutral">{snapshot.versions.length}</span></div>
      {snapshot.versions.length ? <div className="table-scroll"><table className="reports-table"><thead><tr><th>Cliente</th><th>Relatório</th><th>Período</th><th>Estado</th><th>Ação</th></tr></thead><tbody>
        {snapshot.versions.map(version => <tr key={version.id}>
          <td><strong>{version.clientName}</strong></td>
          <td>{version.title} <span className="muted">· v{version.versionNumber}</span></td>
          <td>{formatDate(version.dateFrom)} – {formatDate(version.dateTo)}</td>
          <td><span className={version.state === "published" ? "badge green" : version.state === "ready" ? "badge amber" : "badge neutral"}>{version.state === "published" ? "Publicado" : version.state === "ready" ? "Pronto para publicar" : "Versão anterior"}</span></td>
          <td><div className="flex flex-wrap gap-2"><Button className="button-sm" variant="secondary" onClick={() => viewReport(version)} disabled={pending}><Eye size={13} />Visualizar</Button>{version.state === "ready" && canEdit ? <Button className="button-sm" onClick={() => publish(version.id)} disabled={pending}><Send size={13} />Publicar</Button> : version.state === "published" ? <span className="planned-note"><CheckCircle2 size={14} />Disponível</span> : <span className="planned-note"><Clock3 size={14} />Histórico</span>}{canEdit && version.state !== "ready" && <Button className="button-sm" variant="secondary" onClick={() => startRevision(version)} disabled={pending}><GitBranchPlus size={13} />Nova versão</Button>}</div></td>
        </tr>)}
      </tbody></table></div> : <div className="empty-state"><CalendarDays size={26} /><h3>Nenhum relatório gerado</h3><p>Após coletar os dados de um cliente, gere a primeira versão aqui.</p></div>}
    </section>
    <Dialog open={!!viewing} onOpenChange={open => { if (!open) setViewing(null); }} title={viewing ? `${viewing.title} · v${viewing.versionNumber}` : "Relatório"} description={viewing?.clientName}>
      {previewError ? <p role="alert" className="text-sm text-rose-400">{previewError}</p> : !preview ? <p role="status">Carregando relatório…</p> : <>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="badge neutral">{preview.state === "ready" ? "Prévia · pronto para publicar" : preview.state === "published" ? "Publicado" : "Versão anterior"}</span>
          <span className="muted text-sm">{formatDate(preview.dateFrom)} – {formatDate(preview.dateTo)}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {preview.metrics.map(metric => <div className="report-preview-metric" key={metric.metricKey}><p>{metric.label}</p><strong>{formatPreviewMetric(metric, preview.currency)}</strong></div>)}
        </div>
        {!preview.metrics.length && <p>Esta versão não possui indicadores disponíveis.</p>}
        <p className="muted mt-5 text-sm">Valores preservados nesta versão. Novas coletas não alteram este relatório.</p>
        {viewing && <><div className="mt-4"><Link className="text-link" href={`/cliente/${viewing.clientId}?periodo=custom&from=${preview.dateFrom}&to=${preview.dateTo}`}>Explorar dashboard do cliente</Link></div><label className="mt-5 block text-sm" htmlFor="report-short-summary">Resumo curto para WhatsApp</label><textarea id="report-short-summary" className="input mt-2" rows={4} readOnly value={shortReportSummary(viewing, preview)} /></>}
      </>}
    </Dialog>
  </div>;
}

function shortReportSummary(version: AdminReportVersion, preview: AdminReportPreview) {
  const keys = ["spend", "impressions", "link_clicks", "conversations", "leads", "purchases"];
  const values = preview.metrics.filter(metric => keys.includes(metric.metricKey) && metric.numericValue !== null)
    .map(metric => `${metric.label}: ${formatPreviewMetric(metric, preview.currency)}`);
  return `${version.clientName} · ${formatDate(preview.dateFrom)} a ${formatDate(preview.dateTo)}\n${values.join(" · ")}\nDetalhamento no dashboard do cliente.`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"));
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
