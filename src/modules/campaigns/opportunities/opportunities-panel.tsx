"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { ACTION_LABELS, JOB_STATUS_LABELS } from "../manual/entity-operations";
import { currencyExponent, formatMinor } from "../manual/contracts";
import { analyzeOpportunitiesAction, loadOpportunitiesAction } from "./actions";
import { STAGE_LABELS, STAGE_ORDER, stageForJobStatus, type AnalyzeResult, type OpportunityJob, type OpportunityStage, type OpportunityState } from "./contracts";
import "./opportunities.css";

/** Nome e gasto CONFIRMADO do período, vindos dos dados da tela, só para mostrar o impacto conhecido (nunca estimado). */
export type EntityHint = { name: string; level: "campaign" | "adset" | "ad"; spend: number | null; currency: string };
export type OpportunitiesLoader = (input: { clientId: string }) => Promise<OpportunityState | null>;
export type OpportunitiesAnalyzer = (input: { clientId: string }) => Promise<AnalyzeResult>;

const stamp = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : stamp.format(d); };
const money = (value: number, currency: string) => { const exponent = currencyExponent(currency) ?? 2; return formatMinor(Math.round(value * 10 ** exponent), currency, exponent); };

function Impact({ job, hint, currency }: { job: OpportunityJob; hint: EntityHint | undefined; currency: string }) {
  const exponent = currencyExponent(currency) ?? 2;
  if (job.action.startsWith("set_")) return <small>Novo orçamento diário proposto: <strong>{job.dailyBudgetMinor !== null ? formatMinor(job.dailyBudgetMinor, currency, exponent) : "—"}</strong>. A variação em relação ao atual é conferida na Meta no momento da execução.</small>;
  const spend = hint?.spend;
  return <small>{job.action.startsWith("pause_") ? "Interrompe a veiculação." : "Retoma a veiculação e o gasto."}{" "}
    {spend !== null && spend !== undefined ? <>Gasto confirmado no período selecionado: <strong>{money(spend, hint?.currency ?? currency)}</strong>.</> : "Impacto financeiro não calculado: gasto do período indisponível."}</small>;
}

export function OpportunitiesPanel({ clientId, entities, currency, accountCurrencies = {}, accountNames = {}, loader = loadOpportunitiesAction, analyzer = analyzeOpportunitiesAction, initial = null, approvalsHref = "/agente/aprovacoes" }: {
  clientId: string; entities: Record<string, EntityHint>; currency: string; accountCurrencies?: Record<string, string>; accountNames?: Record<string, string>; loader?: OpportunitiesLoader; analyzer?: OpportunitiesAnalyzer;
  initial?: OpportunityState | null; approvalsHref?: string;
}) {
  const [state, setState] = useState<OpportunityState | null>(initial);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);

  // Aberta pelo atalho do Assistente (evento na mesma página ou endereço com âncora). Só abre e rola; NUNCA inicia a análise.
  useEffect(() => {
    const reveal = () => { setOpen(true); window.setTimeout(() => { const root = document.getElementById("analise-operacional"); root?.scrollIntoView({ block: "start" }); root?.querySelector<HTMLButtonElement>(".opps-btn")?.focus({ preventScroll: true }); }, 60); };
    if (window.location.hash === "#analise-operacional") reveal();
    window.addEventListener("groow:open-opportunities", reveal);
    return () => window.removeEventListener("groow:open-opportunities", reveal);
  }, []);
  useEffect(() => {
    let alive = true;
    loader({ clientId }).then(next => { if (alive && next) setState(next); }).catch(() => { /* sem estado: a seção não aparece */ });
    return () => { alive = false; };
  }, [loader, clientId]);

  const analyze = async () => {
    if (running) return;
    setRunning(true); setNotice(null); setOpen(true);
    try {
      const result = await analyzer({ clientId });
      if (result.state) setState(result.state);
      if (result.ok) {
        const skipped = result.summary.skipped;
        setNotice(result.summary.analyzedAccounts > 0
          ? { tone: "good", text: `Análise concluída em ${result.summary.analyzedAccounts} ${result.summary.analyzedAccounts === 1 ? "conta" : "contas"}. Nenhuma alteração foi feita nas campanhas.${skipped.length ? ` ${skipped.map(item => item.message).join(" ")}` : ""}` }
          : { tone: "warn", text: skipped.length ? skipped.map(item => item.message).join(" ") : "Nenhuma conta pôde ser analisada agora." });
      } else setNotice({ tone: result.code === "unauthorized" ? "warn" : "bad", text: result.message });
    } catch { setNotice({ tone: "bad", text: "Não foi possível concluir a análise agora. Nada foi alterado nas campanhas." }); }
    finally { setRunning(false); }
  };

  const grouped = useMemo(() => {
    const groups: Record<OpportunityStage, { key: string; node: React.ReactNode }[]> = { observation: [], recommendation: [], proposal: [], awaiting_approval: [], executed: [] };
    if (!state) return groups;
    const latest = state.runs[0];
    for (const [index, item] of (latest?.observations ?? []).entries()) groups.observation.push({ key: `o${index}`, node: <><strong>{item.name}</strong><span>{item.rationale}</span></> });
    for (const run of state.runs.slice(0, 2)) if (run.summary) groups.recommendation.push({ key: `r${run.id}`, node: <><span>{run.summary}</span><small>{when(run.createdAt)} · {run.origin === "manual" ? "pedida manualmente" : "análise agendada"}</small></> });
    for (const job of state.jobs) {
      const stage = job.expired ? null : stageForJobStatus(job.status);
      if (!stage) continue;
      const hint = entities[job.entityId];
      const status = JOB_STATUS_LABELS[job.status];
      groups[stage].push({ key: `j${job.id}`, node: <>
        <strong>{ACTION_LABELS[job.action] ?? job.action}: {hint?.name ?? `entidade ${job.entityId}`}</strong>
        <Impact job={job} hint={hint} currency={accountCurrencies[job.accountId] ?? currency} />
        {job.reason && <small className="opps-reason-text">Motivo: {job.reason}</small>}
        <small>{accountNames[job.accountId] ? `${accountNames[job.accountId]} · ` : ""}{when(job.createdAt)} · proposta da IA{stage === "awaiting_approval" && job.expiresAt ? ` · válida até ${when(job.expiresAt)}` : ""}{stage === "executed" ? " · aprovada por uma pessoa e confirmada na Meta" : ""}{stage === "proposal" && status ? ` · ${status.label}` : ""}</small>
        {stage === "awaiting_approval" && <Link className="opps-link" href={approvalsHref}>Revisar e aprovar <ChevronRight size={13} /></Link>}
      </> });
    }
    return groups;
  }, [state, entities, currency, accountCurrencies, accountNames, approvalsHref]);

  const pending = grouped.awaiting_approval.length;
  const availability = state?.availability;
  const canAnalyze = availability?.state === "available" && !running;
  if (!state) return null; // enquanto não houver estado (carregando ou indisponível) a seção não aparece
  if (state?.availability.state === "unauthorized") return null; // quem não pode analisar nem aprovar não vê a seção

  return <section className="opps" id="analise-operacional" aria-label="Análise operacional com IA">
    <button type="button" className="opps-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="opps-title"><Sparkles size={15} /> Análise operacional com IA <em className="opps-badge">IA</em></span>
      <span className="opps-chips">
        {pending > 0 && <span className="opps-chip is-warn">{pending} {pending === 1 ? "aguardando aprovação" : "aguardando aprovação"}</span>}
        {availability && availability.state !== "available" && <span className="opps-chip">Indisponível</span>}
      </span>
      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
    </button>
    {open && <div className="opps-body">
      <p className="opps-scope"><ShieldCheck size={14} /> <span>Escopo real: a IA lê campanhas e conjuntos de anúncios {availability?.state === "available" ? `de ${availability.accounts} ${availability.accounts === 1 ? "conta com delegação vigente" : "contas com delegação vigente"}` : "de contas com delegação vigente"}, compara os últimos {state?.scope.windowDays ?? 14} dias com os {state?.scope.windowDays ?? 14} anteriores e pode propor {state?.scope.actions.join(", ") ?? "ações"}. <strong>Nada é executado sem a aprovação específica de um proprietário ou administrador.</strong> Anúncios, criação de campanhas, públicos e criativos não são analisados nem alterados por aqui.</span></p>
      <div className="opps-run">
        <button type="button" className="opps-btn" disabled={!canAnalyze} onClick={() => void analyze()}>{running ? <><Loader2 size={14} className="opps-spin" /> Analisando… pode levar alguns instantes</> : <><Sparkles size={14} /> Analisar oportunidades</>}</button>
        {availability && availability.state !== "available" && <small className="opps-reason" role="status"><TriangleAlert size={13} /> {availability.message}</small>}
        {availability?.state === "available" && <small className="opps-reason">Usa a cota de IA da organização. A análise só propõe: nenhuma campanha é alterada.</small>}
      </div>
      {notice && <p className={`opps-notice is-${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>{notice.text}</p>}
      {STAGE_ORDER.every(stage => grouped[stage].length === 0) && <p className="opps-empty">Nenhuma observação, recomendação ou proposta registrada para este cliente ainda. Use Analisar oportunidades para pedir uma análise.</p>}
      <div className="opps-stages">{STAGE_ORDER.filter(stage => grouped[stage].length > 0).map(stage => <section key={stage} className={`opps-stage is-${stage}`} aria-label={STAGE_LABELS[stage].label}>
        <header><h3>{STAGE_LABELS[stage].label} <span>{grouped[stage].length}</span></h3><small>{STAGE_LABELS[stage].hint}</small></header>
        <ul>{grouped[stage].map(item => <li key={item.key}>{item.node}</li>)}</ul>
      </section>)}</div>
      {STAGE_ORDER.some(stage => grouped[stage].length === 0) && STAGE_ORDER.some(stage => grouped[stage].length > 0) && <p className="opps-empty">Sem itens em: {STAGE_ORDER.filter(stage => grouped[stage].length === 0).map(stage => STAGE_LABELS[stage].label).join(", ")}.</p>}
    </div>}
  </section>;
}
