import Link from "next/link";
import {
  BarChart3,
  CalendarRange,
  CircleDollarSign,
  Clock3,
  FileText,
  Info,
  MousePointerClick,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { Metadata } from "next";
import { requireClientPortalAccess } from "@/modules/client-portal/context";
import {
  getClientPortalMetricView,
  normalizePortalPeriod,
  type ClientPortalMetricView,
} from "@/modules/client-portal/metrics";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";

export const metadata: Metadata = {
  title: "Visão do cliente",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ClientOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { clientId } = await params;
  const query = await searchParams;
  const period = normalizePortalPeriod(query.periodo);
  const { supabase, user, access, accesses } = await requireClientPortalAccess(clientId);
  const { client } = access;
  const metricView = await getClientPortalMetricView(supabase, clientId, period);

  return (
    <ClientPortalShell
      title={client.name}
      description="Acompanhe os indicadores disponibilizados pela agência em um ambiente seguro e restrito ao seu negócio."
      userEmail={user.email}
      showClientSwitcher={accesses.length > 1}
    >
      {client.archivedAt && (
        <div role="status" className="client-alert">
          <Info size={16} />
          <p>Este cliente está arquivado. O histórico continuará acessível conforme os dados preservados pela agência.</p>
        </div>
      )}

      <div className="client-period-bar">
        <span>Período</span>
        <div>
          <Link
            href={`/cliente/${clientId}?periodo=7d`}
            aria-current={period === "7d" ? "page" : undefined}
            className={period === "7d" ? "active" : ""}
          >
            7 dias
          </Link>
          <Link
            href={`/cliente/${clientId}?periodo=30d`}
            aria-current={period === "30d" ? "page" : undefined}
            className={period === "30d" ? "active" : ""}
          >
            30 dias
          </Link>
        </div>
      </div>

      <section className="client-status-grid">
        <PortalStatusCard
          icon={<CalendarRange size={16} />}
          label="Período consultado"
          value={formatPeriod(metricView)}
        />
        <PortalStatusCard
          icon={<Clock3 size={16} />}
          label="Dados até"
          value={formatDate(metricView.context.latestDataDate)}
        />
        <PortalStatusCard
          icon={<WalletCards size={16} />}
          label="Contas monitoradas"
          value={metricView.context.adAccountCount
            ? String(metricView.context.adAccountCount)
            : "Nenhuma"}
        />
      </section>

      <section className="client-dashboard-grid">
        <div className="client-panel client-performance-panel">
          <div className="client-panel-heading client-panel-heading-split">
            <div className="flex items-center gap-2">
              <span className="client-panel-icon"><BarChart3 size={17} /></span>
              <div>
                <h2>Dados de desempenho</h2>
                <p>Indicadores consolidados do período selecionado</p>
              </div>
            </div>
            {metricView.context.currency && (
              <span className="client-context-badge">
                {metricView.context.currency}
              </span>
            )}
          </div>

          <PerformanceContent view={metricView} />
        </div>

        <div className="client-panel">
          <div className="client-panel-heading">
            <span className="client-panel-icon"><FileText size={17} /></span>
            <div>
              <h2>Histórico de relatórios</h2>
              <p>Versões publicadas para este cliente</p>
            </div>
          </div>
          <div className="client-report-empty">
            <strong>Nenhum relatório publicado</strong>
            <p>
              O histórico de versões aparecerá aqui quando o módulo de publicação de relatórios estiver habilitado.
            </p>
          </div>
        </div>
      </section>
    </ClientPortalShell>
  );
}

function PerformanceContent({ view }: { view: ClientPortalMetricView }) {
  const { context, summary } = view;

  if (context.dataStatus === "setup_pending") {
    return (
      <PortalEmpty
        title="Dados em preparação"
        description="A área de métricas está pronta no produto, mas a base de dados ainda está sendo habilitada pela agência."
      />
    );
  }

  if (context.dataStatus === "no_accounts") {
    return (
      <PortalEmpty
        title="Dados ainda não configurados"
        description="A agência ainda não associou uma conta de anúncios Meta a este cliente."
      />
    );
  }

  if (context.dataStatus === "incompatible") {
    const issue = context.compatibilityIssue === "multiple_currencies"
      ? "As contas associadas usam moedas diferentes."
      : "As contas associadas usam fusos horários diferentes.";
    return (
      <PortalEmpty
        title="Contas não podem ser consolidadas"
        description={`${issue} Para preservar a precisão, o iGrow Reports não mistura esses dados em um único total.`}
      />
    );
  }

  if (!summary || summary.data_status === "no_data") {
    return (
      <PortalEmpty
        title="Sem dados no período"
        description="Nenhum dado de desempenho foi coletado para o intervalo selecionado. Isso não é convertido em zero."
      />
    );
  }

  if (summary.data_status !== "ok") {
    return (
      <PortalEmpty
        title="Dados temporariamente indisponíveis"
        description="A consolidação não pôde ser concluída com segurança para este período."
      />
    );
  }

  const primaryLabel = primaryMetricLabel(summary.primary_metric_key);
  const currency = summary.currency ?? context.currency;

  const metrics = [
    {
      label: "Investimento",
      value: formatCurrency(summary.spend, currency),
      icon: CircleDollarSign,
    },
    {
      label: "Impressões",
      value: formatInteger(summary.impressions),
      icon: TrendingUp,
    },
    {
      label: "Cliques no link",
      value: formatInteger(summary.link_clicks),
      icon: MousePointerClick,
    },
    {
      label: primaryLabel,
      value: formatDecimal(summary.primary_results, 0),
      icon: Target,
    },
    {
      label: "CTR de link",
      value: formatPercent(summary.ctr_link),
      icon: BarChart3,
    },
    {
      label: `Custo por ${primaryLabel.toLocaleLowerCase("pt-BR").replace(/s$/, "")}`,
      value: formatCurrency(summary.cost_per_result, currency),
      icon: CircleDollarSign,
    },
  ];

  return (
    <>
      <div className="client-metrics-grid">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div className="client-metric-card" key={label}>
            <span><Icon size={15} /></span>
            <p>{label}</p>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="client-secondary-metrics">
        <MetricInline label="CPC de link" value={formatCurrency(summary.cpc_link, currency)} />
        <MetricInline label="CPM" value={formatCurrency(summary.cpm, currency)} />
        <MetricInline label="Receita atribuída Meta" value={formatCurrency(summary.attributed_revenue, currency)} />
        <MetricInline label="ROAS Meta" value={formatRatio(summary.roas)} />
      </div>
      <p className="client-data-note">
        Receita e ROAS, quando disponíveis, representam atribuição informada pela Meta e não faturamento confirmado da empresa.
      </p>
    </>
  );
}

function PortalEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="client-empty">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PortalStatusCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="client-status-card">
      <span className="client-status-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Sem dados";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatPeriod(view: ClientPortalMetricView) {
  if (!view.dateFrom || !view.dateTo) return "Aguardando configuração";
  return `${formatDate(view.dateFrom)} – ${formatDate(view.dateTo)}`;
}

function formatNumber(value: number | null, options?: Intl.NumberFormatOptions) {
  if (value === null || !Number.isFinite(Number(value))) return "Indisponível";
  return new Intl.NumberFormat("pt-BR", options).format(Number(value));
}

function formatCurrency(value: number | null, currency: string | null) {
  if (!currency) return "Indisponível";
  try {
    return formatNumber(value, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "Indisponível";
  }
}

function formatInteger(value: number | null) {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function formatDecimal(value: number | null, precision = 2) {
  return formatNumber(value, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function formatPercent(value: number | null) {
  const formatted = formatDecimal(value, 2);
  return formatted === "Indisponível" ? formatted : `${formatted}%`;
}

function formatRatio(value: number | null) {
  const formatted = formatDecimal(value, 2);
  return formatted === "Indisponível" ? formatted : `${formatted}×`;
}

function primaryMetricLabel(value: string | null) {
  if (value === "leads") return "Leads";
  if (value === "conversations") return "Conversas";
  if (value === "purchases") return "Compras";
  return "Resultado principal";
}
