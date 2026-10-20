"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, History, Loader2, Pause, Play, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import {
  currencyExponent, formatMinor, parseBudgetInput, validateBudgetChange,
  type ManualControl, type ManualHistoryItem, type ManualLevel, type ManualOp, type ManualRef, type ManualRunResult,
} from "./contracts";
import { loadManualControlAction, runManualOperationAction } from "./actions";
import "./operations.css";

export type OperationsLoader = (ref: ManualRef) => Promise<{ control: ManualControl; history: ManualHistoryItem[] | null }>;
export type OperationsRunner = (input: {
  ref: ManualRef; op: ManualOp; requestId: string;
  expected: { configuredStatus: "ACTIVE" | "PAUSED"; dailyBudgetMinor: number | null }; dailyBudgetMinor?: number;
}) => Promise<ManualRunResult & { history?: ManualHistoryItem[] | null }>;

/** Permite trocar as chamadas ao servidor (testes e capturas locais). Em produção ninguém fornece este contexto: valem as ações do servidor. */
export const OperationsServicesContext = createContext<{ loader?: OperationsLoader; runner?: OperationsRunner }>({});

const LEVEL_LABEL: Record<ManualLevel, string> = { campaign: "campanha", adset: "conjunto de anúncios" };
const OP_LABEL: Record<ManualOp, string> = { pause: "Pausar", resume: "Retomar", budget: "Alterar orçamento diário" };
export const ACTION_LABELS: Record<string, string> = {
  pause_campaign: "Pausar campanha", resume_campaign: "Retomar campanha", pause_adset: "Pausar conjunto", resume_adset: "Retomar conjunto",
  set_campaign_daily_budget: "Alterar orçamento diário da campanha", set_adset_daily_budget: "Alterar orçamento diário do conjunto",
};
export const JOB_STATUS_LABELS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  proposed: { label: "Solicitada", tone: "neutral" }, awaiting_approval: { label: "Aguardando aprovação humana", tone: "warn" }, authorized: { label: "Autorizada", tone: "neutral" },
  queued: { label: "Na fila", tone: "neutral" }, executing: { label: "Executando", tone: "warn" }, verifying: { label: "Verificando na Meta", tone: "warn" },
  verified: { label: "Confirmada na Meta", tone: "good" }, needs_verification: { label: "Aguardando verificação", tone: "warn" },
  failed: { label: "Não executada", tone: "bad" }, rejected: { label: "Recusada", tone: "bad" }, expired: { label: "Expirada", tone: "neutral" },
};
const STATUS_NAME: Record<string, string> = { ACTIVE: "Ativa", PAUSED: "Pausada" };
const stamp = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const when = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "—" : stamp.format(date); };

function historyDetail(item: ManualHistoryItem, currency: string, exponent: number) {
  const money = (value: number | null) => value === null ? null : formatMinor(value, currency, exponent);
  if (item.action.startsWith("set_")) {
    const previous = money(item.previousBudgetMinor), requested = money(item.requestedBudgetMinor), confirmed = money(item.confirmedBudgetMinor);
    return `${previous ?? "valor anterior não registrado"} → ${requested ?? "—"}${confirmed ? ` (confirmado: ${confirmed})` : ""}`;
  }
  if (item.previousStatus || item.confirmedStatus) return `${STATUS_NAME[item.previousStatus ?? ""] ?? item.previousStatus ?? "—"} → ${STATUS_NAME[item.confirmedStatus ?? ""] ?? (item.confirmedStatus ?? "confirmação pendente")}`;
  return null;
}

export function OperationsHistory({ items, currency }: { items: ManualHistoryItem[]; currency: string }) {
  const exponent = currencyExponent(currency) ?? 2;
  if (items.length === 0) return <p className="ops-note">Nenhuma operação registrada para esta entidade.</p>;
  return <ol className="ops-history" aria-label="Histórico de operações">{items.map(item => {
    const status = JOB_STATUS_LABELS[item.status] ?? { label: item.status, tone: "neutral" as const };
    const detail = historyDetail(item, currency, exponent);
    return <li key={item.id}>
      <div className="ops-history-head"><strong>{ACTION_LABELS[item.action] ?? item.action}</strong><span className={`ops-pill is-${status.tone}`}>{status.label}</span></div>
      <small>{when(item.createdAt)} · {item.origin === "manual" ? `Manual (${item.requestedBy === "you" ? "você" : "outro usuário"})` : `Proposta da IA${item.approved ? ", aprovada por uma pessoa" : ", sem aprovação"}`}</small>
      {detail && <small>{detail}</small>}
    </li>;
  })}</ol>;
}

type Dialog = { op: ManualOp; requestId: string };
type Banner = { tone: "good" | "warn" | "bad"; text: string };

/**
 * Operações MANUAIS de uma campanha ou conjunto: estado atual lido AGORA na Meta, ações oferecidas conforme o servidor decide e
 * confirmação explícita antes de qualquer envio. O servidor revalida tudo de novo; a tela nunca é a fonte de permissão ou de estado.
 */
export function EntityOperations({ clientId, accountId, level, entityId, entityName, accountName, currency, loader: loaderProp, runner: runnerProp, refresh }: {
  clientId: string; accountId: string; level: ManualLevel; entityId: string; entityName: string; accountName: string; currency: string;
  loader?: OperationsLoader; runner?: OperationsRunner; refresh?: () => void;
}) {
  const router = useRouter();
  const services = useContext(OperationsServicesContext);
  const loader = loaderProp ?? services.loader ?? loadManualControlAction;
  const runner = runnerProp ?? services.runner ?? runManualOperationAction;
  const ref: ManualRef = { clientId, accountId, level, entityId };
  const [control, setControl] = useState<ManualControl | null>(null);
  const [history, setHistory] = useState<ManualHistoryItem[] | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const titleId = useId();

  const load = useCallback(async () => {
    try {
      const result = await loader({ clientId, accountId, level, entityId });
      setControl(result.control); setHistory(result.history);
    } catch { setControl({ kind: "unknown_state", message: "Não foi possível consultar o estado atual agora." }); }
  }, [loader, clientId, accountId, level, entityId]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (op: ManualOp, requestId: string, dailyBudgetMinor?: number) => {
    if (control?.kind !== "ready" || running) return;
    setRunning(true); setBanner(null);
    try {
      const result = await runner({ ref, op, requestId, expected: { configuredStatus: control.configuredStatus, dailyBudgetMinor: control.dailyBudgetMinor }, ...(dailyBudgetMinor !== undefined ? { dailyBudgetMinor } : {}) });
      if (result.history) setHistory(result.history);
      if (result.ok) {
        if (result.control) setControl(result.control); else void load();
        setBanner({ tone: result.outcome === "verified" ? "good" : "warn", text: result.message });
        // Os dados da tela só são atualizados depois da confirmação efetiva da Meta.
        if (result.outcome === "verified") (refresh ?? (() => router.refresh()))();
      } else {
        if (result.control) setControl(result.control); else if (result.code !== "duplicate") void load();
        setBanner({ tone: result.code === "stale" || result.code === "busy" || result.code === "duplicate" ? "warn" : "bad", text: result.message });
      }
    } catch { setBanner({ tone: "warn", text: "Não foi possível confirmar o resultado. Consulte o histórico antes de tentar novamente." }); void load(); }
    finally { setRunning(false); setDialog(null); }
  };

  const header = <header className="ops-head"><h2>Operações</h2><span className="ops-badge" title="Alterações reais na Meta, feitas por você">Manual</span></header>;
  if (!control) return <section className="analytics-card cdetail-card ops" aria-label="Operações da entidade" aria-busy="true">{header}<p className="ops-note" role="status"><Loader2 size={14} className="ops-spin" /> Consultando o estado atual na Meta…</p></section>;
  if (control.kind !== "ready") {
    if (control.kind === "unauthorized") return <section className="analytics-card cdetail-card ops" aria-label="Operações da entidade">{header}<p className="ops-note is-info" role="status"><ShieldAlert size={14} /> {control.message}</p></section>;
    const reconnect = control.kind === "write_permission_missing" || control.kind === "account_disconnected";
    const retry = control.kind === "unknown_state" || control.kind === "account_disconnected" || (control.kind === "write_permission_missing" && (control.reason === "unverified" || control.reason === "token_invalid"));
    const title = control.kind === "write_permission_missing" ? "Gerenciamento de anúncios não autorizado"
      : control.kind === "account_restricted" ? "Conta de anúncios com restrição na Meta"
      : control.kind === "account_disconnected" ? "Conexão com a Meta indisponível"
      : control.kind === "executor_disabled" ? "Alterações ainda não habilitadas"
      : control.kind === "unknown_state" ? "Estado atual não confirmado" : null;
    return <section className="analytics-card cdetail-card ops" aria-label="Operações da entidade">{header}
      {title && <strong className="ops-state-title">{title}</strong>}
      {(control.kind === "write_permission_missing" || control.kind === "account_restricted") && <p className="ops-note is-info" role="status"><ShieldCheck size={14} /> A leitura de dados desta conta continua funcionando; só as alterações (pausar, retomar e orçamento) estão indisponíveis.</p>}
      <p className={`ops-note ${control.kind === "incompatible" ? "" : "is-warn"}`} role="status">{control.message}</p>
      <div className="ops-actions">
        {reconnect && <Link className="ops-btn is-primary" href="/integracoes">Abrir Integrações para autorizar<ExternalLink size={13} /></Link>}
        {retry && <button type="button" className="ops-btn" onClick={() => { setControl(null); void load(); }}>Consultar novamente</button>}
      </div>
      {history && history.length > 0 && <HistoryToggle show={showHistory} onToggle={setShowHistory} items={history} currency={currency} />}
    </section>;
  }

  const exponent = control.exponent;
  const money = (value: number) => formatMinor(value, control.currency, exponent);
  const button = (op: ManualOp, icon: React.ReactNode) => {
    const availability = control.ops[op];
    return <div className="ops-action" key={op}>
      <button type="button" className="ops-btn" disabled={!availability.enabled || running} onClick={() => { setBanner(null); setDialog({ op, requestId: crypto.randomUUID() }); }}>{icon}{OP_LABEL[op]}</button>
      {!availability.enabled && availability.reason && op !== "pause" && !(op === "resume" && control.configuredStatus === "ACTIVE") && <small className="ops-reason">{availability.reason}</small>}
    </div>;
  };

  return <section className="analytics-card cdetail-card ops" aria-label="Operações da entidade" aria-busy={running}>
    {header}
    <dl className="cdetail-facts">
      <div><dt>Estado na Meta (agora)</dt><dd><span className={`ops-pill is-${control.configuredStatus === "ACTIVE" ? "good" : "neutral"}`}>{STATUS_NAME[control.configuredStatus]}</span></dd></div>
      <div><dt>Orçamento diário atual</dt><dd>{control.dailyBudgetMinor !== null ? money(control.dailyBudgetMinor) : "Não definido neste nível"}</dd></div>
    </dl>
    {control.busy && <p className="ops-note is-warn" role="status"><Loader2 size={14} className="ops-spin" /> Há uma operação em andamento ou aguardando verificação nesta conta. Novas alterações ficam bloqueadas até a conclusão.</p>}
    <div className="ops-actions">
      {control.configuredStatus === "ACTIVE" ? button("pause", <Pause size={14} />) : button("resume", <Play size={14} />)}
      {button("budget", <Wallet size={14} />)}
    </div>
    {banner && <p className={`ops-banner is-${banner.tone}`} role={banner.tone === "bad" ? "alert" : "status"}>{banner.text}</p>}
    <small className="ops-foot">Estado conferido na Meta às {when(control.checkedAt)}. Cada alteração é confirmada na Meta antes de ser exibida.</small>
    {history && <HistoryToggle show={showHistory} onToggle={setShowHistory} items={history} currency={control.currency} />}
    {dialog && <ConfirmDialog titleId={titleId} control={control} op={dialog.op} entityName={entityName} accountName={accountName} level={level} running={running}
      onCancel={() => { if (!running) setDialog(null); }} onConfirm={minor => void submit(dialog.op, dialog.requestId, minor)} />}
  </section>;
}

function HistoryToggle({ show, onToggle, items, currency }: { show: boolean; onToggle: (value: boolean) => void; items: ManualHistoryItem[]; currency: string }) {
  return <div className="ops-history-wrap">
    <button type="button" className="ops-link" aria-expanded={show} onClick={() => onToggle(!show)}><History size={13} />{show ? "Ocultar histórico" : `Histórico de operações (${items.length})`}</button>
    {show && <OperationsHistory items={items} currency={currency} />}
  </div>;
}

function ConfirmDialog({ titleId, control, op, entityName, accountName, level, running, onCancel, onConfirm }: {
  titleId: string; control: Extract<ManualControl, { kind: "ready" }>; op: ManualOp; entityName: string; accountName: string; level: ManualLevel;
  running: boolean; onCancel: () => void; onConfirm: (budgetMinor?: number) => void;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [understood, setUnderstood] = useState(false);
  useEffect(() => { const node = element.current; if (node && !node.open) node.showModal(); }, []);
  const money = (value: number) => formatMinor(value, control.currency, control.exponent);
  const parsed = op === "budget" ? parseBudgetInput(text, control.exponent) : null;
  const rule = parsed?.ok ? validateBudgetChange(control.dailyBudgetMinor, parsed.minor) : null;
  const budgetError = op === "budget" && text.trim() ? (parsed && !parsed.ok ? parsed.message : rule && !rule.ok ? rule.message : null) : null;
  const next = op === "budget" && parsed?.ok && rule?.ok ? parsed.minor : null;
  const current = control.dailyBudgetMinor;
  const percent = next !== null && current ? ((next - current) / current) * 100 : null;
  // Retomar e alterar orçamento mudam o gasto: exigem o reconhecimento explícito, além do botão de confirmar.
  const financial = op !== "pause";
  const ready = !running && (op !== "budget" || next !== null) && (!financial || understood);
  const title = `${OP_LABEL[op]} — ${LEVEL_LABEL[level]}`;
  const consequence = op === "pause" ? "A veiculação será interrompida e o gasto desta entidade deve parar. Você pode retomar depois."
    : op === "resume" ? `A veiculação será retomada${current !== null ? ` com o orçamento diário atual de ${money(current)}` : ""} e o gasto voltará a ocorrer.${level === "adset" ? " Se a campanha estiver pausada, o conjunto só entregará quando ela for retomada." : ""}`
    : "O novo orçamento vale a partir da confirmação e o gasto diário pode mudar. A Meta pode levar algum tempo para reequilibrar a entrega.";
  return <dialog ref={element} className="ops-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onCancel(); }} onClose={onCancel}>
    <form method="dialog" onSubmit={event => { event.preventDefault(); if (ready) onConfirm(next ?? undefined); }}>
      <h3 id={titleId}>{title}</h3>
      <dl className="ops-summary">
        <div><dt>{level === "campaign" ? "Campanha" : "Conjunto"}</dt><dd>{entityName}</dd></div>
        <div><dt>Conta de anúncios</dt><dd>{accountName}</dd></div>
        <div><dt>Operação</dt><dd>{OP_LABEL[op]}</dd></div>
        {op !== "budget" && <div><dt>Estado</dt><dd>{STATUS_NAME[control.configuredStatus]} → {op === "pause" ? "Pausada" : "Ativa"}</dd></div>}
        {op === "budget" && <div><dt>Moeda</dt><dd>{control.currency}</dd></div>}
        {op === "budget" && <div><dt>Orçamento atual (confirmado)</dt><dd>{current !== null ? money(current) : "—"}</dd></div>}
      </dl>
      {op === "budget" && <label className="ops-field"><span>Novo orçamento diário ({control.currency})</span>
        <input inputMode="decimal" autoComplete="off" value={text} disabled={running} onChange={event => setText(event.target.value)} placeholder={control.exponent === 0 ? "ex.: 500" : "ex.: 150,00"} aria-invalid={!!budgetError} aria-describedby={budgetError ? `${titleId}-err` : undefined} />
        {budgetError && <small id={`${titleId}-err`} className="ops-error" role="alert">{budgetError}</small>}</label>}
      {next !== null && current !== null && <p className="ops-change" aria-live="polite"><span>{money(current)}</span> → <strong>{money(next)}</strong>{percent !== null && <em>{percent > 0 ? "+" : ""}{percent.toFixed(1).replace(".", ",")}%</em>}</p>}
      <p className="ops-note is-info">{consequence}</p>
      {financial && <label className="ops-check"><input type="checkbox" checked={understood} disabled={running} onChange={event => setUnderstood(event.target.checked)} /><span>Entendo que esta alteração muda o gasto e será feita agora na conta real da Meta.</span></label>}
      <div className="ops-dialog-actions">
        <button type="button" className="ops-btn" onClick={onCancel} disabled={running}>Cancelar</button>
        <button type="submit" className={`ops-btn is-primary${op === "pause" ? "" : " is-financial"}`} disabled={!ready}>{running ? <><Loader2 size={14} className="ops-spin" /> Enviando e aguardando a Meta…</> : op === "budget" ? "Confirmar novo orçamento" : op === "pause" ? "Confirmar pausa" : "Confirmar retomada"}</button>
      </div>
    </form>
  </dialog>;
}
