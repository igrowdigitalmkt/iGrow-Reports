"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AI_CREDITS_PER_USD, creditsToUsd, formatCredits, usdToCredits } from "./credits";
import { getAiSettings, saveAiSettings, type AiSettingsView } from "./settings-actions";

const credits = (usd: number) => formatCredits(usdToCredits(usd));

export function AiSettingsPanel({ agencyId }: { agencyId: string }) {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getAiSettings({ agencyId }).then(result => {
      if (!live) return;
      if ("error" in result) setError(result.error); else setView(result.settings);
    }).catch(() => { if (live) setError("Não foi possível carregar as configurações de IA."); });
    return () => { live = false; };
  }, [agencyId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const budget = creditsToUsd(Number(String(form.get("budget") ?? "").replace(/\./g, "").replace(",", ".")));
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        const result = await saveAiSettings({ agencyId, enabled: form.get("enabled") === "on", monthlyBudgetUsd: budget });
        if ("error" in result) { setError(result.error); return; }
        setView(result.settings); setNotice("Configuração salva.");
      } catch { setError("Não foi possível concluir. Confira sua conexão e tente novamente."); }
    });
  }

  const used = view ? Math.min(100, view.monthlyBudgetUsd > 0 ? (view.monthCostUsd / view.monthlyBudgetUsd) * 100 : 100) : 0;
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Inteligência artificial</h2><p>Rascunhos de comentário nos relatórios, sempre revisados por você</p></div><Sparkles size={18} className="muted" /></div>
    {!view && !error && <p className="muted text-sm">Carregando…</p>}
    {view && <form onSubmit={submit} key={`${view.enabled}-${view.monthlyBudgetUsd}`}>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="enabled" defaultChecked={view.enabled} disabled={pending} />IA ligada neste espaço de trabalho</label>
      <label className="block text-sm mt-5" htmlFor="ai-budget">Limite mensal de créditos de IA</label>
      <input id="ai-budget" name="budget" className="input mt-2" inputMode="numeric" defaultValue={formatCredits(usdToCredits(view.monthlyBudgetUsd))} disabled={pending} />
      <p className="muted text-xs mt-2">Cada comentário consome em média {formatCredits(AI_CREDITS_PER_USD * 0.01)} a {formatCredits(AI_CREDITS_PER_USD * 0.02)} créditos. Ao atingir o limite, a IA pausa até o mês seguinte.</p>
      <div className="mt-5" role="img" aria-label={`Consumo do mês: ${credits(view.monthCostUsd)} de ${credits(view.monthlyBudgetUsd)} créditos`}>
        <div style={{ height: 8, borderRadius: 4, background: "var(--border)" }}><div style={{ height: 8, borderRadius: 4, width: `${used}%`, background: used >= 90 ? "var(--danger, #c0392b)" : "var(--accent, #2563eb)" }} /></div>
        <p className="text-sm mt-2">{credits(view.monthCostUsd)} de {credits(view.effectiveBudgetUsd)} créditos comprometidos neste mês</p>
      </div>
      <dl className="ai-usage-breakdown text-xs mt-3" aria-label="Detalhe do consumo de IA no mês">
        <div><dt>Consumo liquidado</dt><dd>{credits(view.settledUsd)}</dd></div>
        <div><dt title="Estimativa conservadora de chamadas em andamento; será trocada pelo custo real">Reservado (estimativa)</dt><dd>{credits(view.reservedUsd)}</dd></div>
        <div><dt title="Sem informação do provedor; mantido pela estimativa até a conciliação">Consumo desconhecido{view.reconcileCount ? ` (${view.reconcileCount} a conciliar)` : ""}</dt><dd>{credits(view.unknownUsd)}</dd></div>
        <div><dt>Disponível para novas chamadas</dt><dd>{credits(view.availableUsd)}</dd></div>
      </dl>
      <p className="muted text-xs mt-2">Valores de custo de inteligência artificial; não incluem o investimento em anúncios. Reservas e consumo desconhecido contam contra o orçamento, mas não são gasto definitivo.</p>
      <p className="muted text-xs mt-2">{view.generated} {view.generated === 1 ? "comentário gerado" : "comentários gerados"} neste mês{view.rejected ? `, ${view.rejected} bloqueado(s) por números fora dos dados` : ""}{view.blocked ? `, ${view.blocked} pedido(s) recusado(s) por limite ou desligamento` : ""}.</p>
      {error && <p role="alert" className="mt-4 text-rose-400 text-sm">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
      <Button className="mt-5" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar"}</Button>
    </form>}
    {error && !view && <p role="alert" className="text-rose-400 text-sm">{error}</p>}
  </section>;
}
