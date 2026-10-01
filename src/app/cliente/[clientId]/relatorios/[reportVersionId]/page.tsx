import Link from "next/link";
import { ArrowLeft, CalendarRange, FileText } from "lucide-react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";
import {
  getClientPortalReportMetrics,
  listClientPortalReports,
} from "@/modules/reports/client";

export const metadata: Metadata = {
  title: "Relatório publicado",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ClientPublishedReportPage({
  params,
}: {
  params: Promise<{ clientId: string; reportVersionId: string }>;
}) {
  const { clientId, reportVersionId } = await params;
  const { supabase, user, access, accesses, agencyMode } = await requireClientDashboardAccess(clientId);
  const history = await listClientPortalReports(supabase, clientId);
  const report = history.reports.find((item) => item.reportVersionId === reportVersionId);
  if (!report) notFound();

  const metrics = await getClientPortalReportMetrics(supabase, reportVersionId);

  return (
    <ClientPortalShell
      title={report.title}
      description={`Versão ${report.versionNumber} · ${formatDate(report.dateFrom)} – ${formatDate(report.dateTo)}`}
      userEmail={user.email}
      agencyMode={agencyMode}
      showClientSwitcher={accesses.length > 1}
    >
      <div className="client-report-toolbar">
        <Link href={`/cliente/${clientId}`} className="client-topbar-link">
          <ArrowLeft size={14} />
          Voltar para {access.client.name}
        </Link>
        <span className="client-context-badge">Versão publicada</span>
      </div>

      <section className="client-status-grid">
        <div className="client-status-card">
          <span className="client-status-icon"><CalendarRange size={16} /></span>
          <div>
            <p>Período</p>
            <strong>{formatDate(report.dateFrom)} – {formatDate(report.dateTo)}</strong>
          </div>
        </div>
        <div className="client-status-card">
          <span className="client-status-icon"><FileText size={16} /></span>
          <div>
            <p>Versão</p>
            <strong>v{report.versionNumber}</strong>
          </div>
        </div>
        <div className="client-status-card">
          <span className="client-status-icon"><FileText size={16} /></span>
          <div>
            <p>Publicada em</p>
            <strong>{formatDateTime(report.publishedAt)}</strong>
          </div>
        </div>
      </section>

      <section className="client-panel mt-3">
        <div className="client-panel-heading">
          <span className="client-panel-icon"><FileText size={17} /></span>
          <div>
            <h2>Indicadores congelados</h2>
            <p>Estes valores pertencem a esta versão e não mudam com novas coletas.</p>
          </div>
        </div>

        {metrics.length ? (
          <div className="client-metrics-grid client-report-metrics">
            {metrics.map((metric) => (
              <div className="client-metric-card" key={metric.metricKey}>
                <p>{metric.metricKey === "impressions" ? "Impressões" : metric.label}</p>
                <strong>{formatMetric(metric.numericValue, metric.unit, metric.displayPrecision, report.currency)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="client-report-empty">
            <strong>Métricas indisponíveis</strong>
            <p>Esta versão não possui indicadores legíveis no momento.</p>
          </div>
        )}
      </section>

      <p className="client-data-note">
        Esta página usa apenas o snapshot salvo na publicação. Ela não consulta a Meta para reconstruir números históricos.
      </p>
    </ClientPortalShell>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string | null) {
  if (!value) return "Indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function formatMetric(
  value: number | null,
  unit: "currency" | "integer" | "percent" | "ratio",
  precision: number,
  currency: string | null,
) {
  if (value === null || !Number.isFinite(Number(value))) return "Indisponível";
  const numeric = Number(value);
  if (unit === "currency") {
    if (!currency) return "Indisponível";
    try {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency,
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(numeric);
    } catch {
      return "Indisponível";
    }
  }
  if (unit === "integer") {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(numeric);
  }
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(numeric);
  return unit === "percent" ? `${formatted}%` : `${formatted}×`;
}
