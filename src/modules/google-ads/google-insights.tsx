"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { AccountInsights, DEFAULT_OPTIONAL_ACCOUNT_METRICS, FIXED_ACCOUNT_METRICS } from "@/modules/client-portal/account-insights";
import { SectionToggle } from "@/modules/client-portal/section-toggle";
import { PlatformLogo } from "@/modules/platforms/platform-logo";
import type { GoogleSectionView } from "./google-section";
import { loadGoogleScopeAction } from "./scope-actions";
import "@/modules/client-portal/analytics-dashboard.css";

/** Avisos de qualidade dos dados da plataforma, no mesmo selo da Meta (abre a lista ao clicar). */
function QualityBadge({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return <details className="analytics-quality-menu">
    <summary><Info size={13} />Qualidade dos dados <span className="analytics-count">{warnings.length}</span></summary>
    <div>{warnings.map(warning => <p key={warning}>{warning}</p>)}</div>
  </details>;
}

/**
 * Google Ads no Dashboard, no mesmo padrão de exibição da Meta: um painel completo por conta (indicadores com variação removíveis,
 * trocáveis e reordenáveis, menu Métricas, seleção de campanhas que recalcula tudo, gráfico do período e tabela de campanhas ordenável).
 */
export function GoogleDashboardSection({ sections, failures, order, collapsed, onToggle, clientId, preferenceKey, separate = false }: {
  /** Consolidar desligado: cada conta do Google Ads vira a sua própria linha recolhível ("Google Ads · nome da conta"). */ separate?: boolean;
  sections: GoogleSectionView[]; failures: Array<{ name: string; message: string }>; order?: number; collapsed: boolean; onToggle: () => void; clientId: string; preferenceKey?: string;
}) {
  const available = useMemo(() => new Set(sections.flatMap(section => section.data.metrics.map(metric => metric.key))), [sections]);
  const defaults = useMemo(() => DEFAULT_OPTIONAL_ACCOUNT_METRICS.filter(key => available.has(key)), [available]);
  const [optional, setOptionalState] = useState<string[]>(defaults);
  const [loaded, setLoaded] = useState(false);
  const storageKey = preferenceKey ? `igrow:analytics:${preferenceKey}:google` : null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = storageKey ? JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { overview?: string[] } | null : null;
        if (saved && Array.isArray(saved.overview)) setOptionalState([...new Set(saved.overview.filter(key => available.has(key) && !FIXED_ACCOUNT_METRICS.includes(key)))]);
      } catch { /* Preferências locais inválidas não bloqueiam o painel. */ }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, available]);
  useEffect(() => {
    if (!loaded || !storageKey) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify({ overview: optional })); } catch { /* Armazenamento local bloqueado não impede o painel. */ }
  }, [optional, loaded, storageKey]);
  const setOptional = (update: (keys: string[]) => string[]) => setOptionalState(update);
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const scopeFor = (section: GoogleSectionView) => (campaignIds: string[]) => loadGoogleScopeAction({ clientId, accountId: section.id, dateFrom: section.data.dateFrom, dateTo: section.data.dateTo, campaignIds });

  if (!sections.length && !failures.length) return null;
  if (separate) {
    // Uma linha por conta, cada uma com a sua seta de recolher; avisos de falha ficam na primeira linha.
    return <>{sections.map((section, index) => {
      const shut = collapsedIds.includes(section.id);
      return <section key={section.id} className="platform-section" aria-label={`Google Ads ${section.name}`} style={order === undefined ? undefined : { order }}>
        <div className="platform-heading"><SectionToggle collapsed={shut} label={`Google Ads ${section.name}`} onToggle={() => setCollapsedIds(current => current.includes(section.id) ? current.filter(id => id !== section.id) : [...current, section.id])} /><PlatformLogo platform="google" /><h2>Google Ads</h2>
          <span className="platform-heading-meta">{section.name}</span><QualityBadge warnings={section.data.warnings} /></div>
        {!shut && <>
          {index === 0 && failures.map(failure => <p key={failure.name} role="alert" className="analytics-footnote" style={{ padding: "0 4px" }}>Não foi possível ler a conta {failure.name} agora. {failure.message}</p>)}
          <AccountInsights title={section.name} data={section.data} platform="google" optional={optional} setOptional={setOptional} scopeLoader={scopeFor(section)} showTitle={false} />
        </>}
      </section>;
    })}</>;
  }
  return <section className="platform-section" aria-label="Google Ads" style={order === undefined ? undefined : { order }}>
    <div className="platform-heading"><SectionToggle collapsed={collapsed} label="Google Ads" onToggle={onToggle} /><PlatformLogo platform="google" /><h2>Google Ads</h2>
      <span className="platform-heading-meta">{sections.length} {sections.length === 1 ? "conta" : "contas"}</span>
      <QualityBadge warnings={[...new Set(sections.flatMap(section => section.data.warnings))]} /></div>
    {!collapsed && <>
      {failures.map(failure => <p key={failure.name} role="alert" className="analytics-footnote" style={{ padding: "0 4px" }}>Não foi possível ler a conta {failure.name} agora. {failure.message}</p>)}
      {sections.map(section => <AccountInsights key={section.id} title={section.name} data={section.data} platform="google" optional={optional} setOptional={setOptional} scopeLoader={scopeFor(section)} />)}
    </>}
  </section>;
}
