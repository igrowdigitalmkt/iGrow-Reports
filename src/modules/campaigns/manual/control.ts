import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMetaApiConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { MetaClient } from "@/modules/meta/client";
import { loadAccessToken } from "@/modules/meta/server";
import { requestManualMetaChange, type ManualChangeResult } from "@/modules/agent-executor/manual-actions";
import { agentSchedulerEnabled } from "@/modules/agent-executor/scheduler";
import {
  MANUAL_ACTION_NAMES, currencyExponent, validateBudgetChange,
  type ManualControl, type ManualHistoryItem, type ManualLevel, type ManualOp, type ManualRef, type ManualRunFailureCode, type ManualRunResult, type OpAvailability,
} from "./contracts";

type Service = SupabaseClient<Database>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNSETTLED = ["queued", "executing", "verifying", "needs_verification"] as const;

export type Actor = { agencyId: string; userId: string; role: string };
/** Leitura crua de UMA entidade na Meta (somente GET). `null` = a Meta não devolveu a entidade. Lança em falha de comunicação. */
export type RawEntity = { id?: string; account_id?: string; status?: string; effective_status?: string; daily_budget?: string | number; lifetime_budget?: string | number; objective?: string; campaign_id?: string };
export type EntityReader = (service: Service, scope: { agencyId: string; integrationId: string; connectionId: string }, entityId: string, level: ManualLevel) => Promise<RawEntity | null>;
export type ControlDeps = {
  service: Service;
  executorEnabled?: () => boolean;
  readEntity?: EntityReader;
  request?: (input: unknown) => Promise<ManualChangeResult>;
  now?: () => Date;
};

const message = {
  unauthorized: "Somente proprietários e administradores podem alterar campanhas.",
  executor: "A execução de alterações não está habilitada para esta organização ou ambiente. Nenhuma alteração será enviada à Meta.",
  disconnected: "A conta de anúncios ou a conexão com a Meta está indisponível ou sem permissão de gerenciamento de anúncios.",
  incompatible: "Esta entidade não pertence à conta/cliente informados ou não é uma campanha ou conjunto.",
  unknown: "Não foi possível confirmar o estado atual na Meta agora. Nenhuma ação é oferecida sem essa confirmação.",
} as const;

const defaultReadEntity: EntityReader = async (service, scope, entityId, level) => {
  const apiVersion = getMetaApiConfig()?.apiVersion;
  if (!apiVersion) throw new Error("no_api_version");
  const token = await loadAccessToken(service, scope.agencyId, scope.integrationId, scope.connectionId);
  const client = new MetaClient({ accessToken: token, apiVersion, timeoutMs: 15_000, retryDelayMs: 500 });
  const fields = `id,account_id,status,effective_status,daily_budget,lifetime_budget,${level === "campaign" ? "objective" : "campaign_id"}`;
  const [entity] = await client.getObjects<RawEntity>([entityId], fields);
  return entity ?? null;
};

const digits = (value: unknown) => typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value)
  : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const normalizeAccount = (value: unknown) => typeof value === "string" && /^(?:act_)?[1-9]\d*$/.test(value) ? (value.startsWith("act_") ? value : `act_${value}`) : null;

export function validRef(ref: ManualRef): boolean {
  return UUID.test(ref.clientId) && UUID.test(ref.accountId) && /^[1-9]\d*$/.test(ref.entityId) && (ref.level === "campaign" || ref.level === "adset");
}

type Blocked = Extract<ManualControl, { kind: Exclude<ManualControl["kind"], "ready"> }>;
type Resolved =
  | { ok: true; account: { id: string; externalId: string; name: string; currency: string }; connection: { integrationId: string; connectionId: string } }
  | { ok: false; control: Blocked };
const stop = (kind: Blocked["kind"], text: string): Resolved => ({ ok: false, control: { kind, message: text } });

/** Autorização e escopo no BANCO: papel, cliente da organização, vínculo ativo, conta, conexão com escopo de gerenciamento. Nada vem do navegador. */
async function resolveScope(actor: Actor, ref: ManualRef, deps: ControlDeps): Promise<Resolved> {
  if (actor.role !== "owner" && actor.role !== "admin") return stop("unauthorized", message.unauthorized);
  if (!validRef(ref)) return stop("incompatible", message.incompatible);
  const { service } = deps;
  const [{ data: client }, { data: link }, { data: account }] = await Promise.all([
    service.from("clients").select("id").eq("agency_id", actor.agencyId).eq("id", ref.clientId).is("archived_at", null).maybeSingle(),
    service.from("client_ad_accounts").select("active").eq("agency_id", actor.agencyId).eq("client_id", ref.clientId).eq("ad_account_id", ref.accountId).maybeSingle(),
    service.from("meta_ad_accounts").select("id,external_id,name,currency,account_status,meta_connection_id").eq("agency_id", actor.agencyId).eq("id", ref.accountId).is("archived_at", null).maybeSingle(),
  ]);
  if (!client || !link?.active || !account) return stop("incompatible", message.incompatible);
  const usable = account.account_status === "1" || account.account_status === "ACTIVE";
  const { data: connection } = await service.from("meta_connections").select("id,integration_id,scopes,connected_at")
    .eq("agency_id", actor.agencyId).eq("client_id", ref.clientId).eq("id", account.meta_connection_id).maybeSingle();
  const { data: integration } = connection ? await service.from("integrations").select("id,connection_status,health_status")
    .eq("agency_id", actor.agencyId).eq("id", connection.integration_id).eq("provider", "meta").maybeSingle() : { data: null };
  if (!usable || !connection?.connected_at || !connection.scopes.includes("ads_management") || integration?.connection_status !== "connected" || integration.health_status === "error") {
    return stop("account_disconnected", message.disconnected);
  }
  return { ok: true, account: { id: account.id, externalId: account.external_id, name: account.name, currency: account.currency }, connection: { integrationId: integration.id, connectionId: connection.id } };
}

export async function resolveManualControl(actor: Actor, ref: ManualRef, deps: ControlDeps): Promise<ManualControl> {
  const scope = await resolveScope(actor, ref, deps);
  if (!scope.ok) return scope.control;
  const { service } = deps;
  // Interruptor do ambiente E direito comercial da organização: sem ambos nada é oferecido nem enviado.
  const { data: allowed } = await service.rpc("agent_meta_execution_allowed", { p_agency_id: actor.agencyId });
  if (!(deps.executorEnabled ?? agentSchedulerEnabled)() || allowed !== true) return { kind: "executor_disabled", message: message.executor };

  let raw: RawEntity | null;
  try {
    raw = await (deps.readEntity ?? defaultReadEntity)(service, { agencyId: actor.agencyId, ...scope.connection }, ref.entityId, ref.level);
  } catch { return { kind: "unknown_state", message: message.unknown }; }
  if (!raw) return { kind: "incompatible", message: message.incompatible };
  // Titularidade e tipo vêm do próprio provedor: a conta da Meta precisa ser a vinculada e o campo característico do nível precisa existir.
  if (raw.id !== ref.entityId || normalizeAccount(raw.account_id) !== scope.account.externalId
    || (ref.level === "campaign" ? typeof raw.objective !== "string" || !raw.objective : typeof raw.campaign_id !== "string" || !/^[1-9]\d*$/.test(raw.campaign_id))) {
    return { kind: "incompatible", message: message.incompatible };
  }
  const status = typeof raw.status === "string" ? raw.status.toUpperCase() : "";
  if (status !== "ACTIVE" && status !== "PAUSED") {
    return { kind: "unsupported_status", message: "O estado atual desta entidade (arquivada, excluída, em processamento ou com problemas) não permite pausar, retomar ou alterar o orçamento por aqui." };
  }
  const exponent = currencyExponent(scope.account.currency);
  const lifetime = digits(raw.lifetime_budget);
  const daily = lifetime && lifetime > 0 ? null : digits(raw.daily_budget);
  const { data: open } = await service.from("agent_action_jobs").select("id").eq("agency_id", actor.agencyId).eq("ad_account_id", scope.account.id).in("status", [...UNSETTLED]).limit(1);
  const busy = (open?.length ?? 0) > 0;

  const ops: Record<ManualOp, OpAvailability> = {
    pause: status === "ACTIVE" ? { enabled: true } : { enabled: false, reason: "Já está pausada." },
    resume: status === "PAUSED"
      ? (daily !== null ? { enabled: true } : { enabled: false, reason: "O orçamento diário não está confirmado neste nível (pode estar no conjunto, compartilhado ou ser vitalício); a retomada por aqui exige orçamento confirmado." })
      : { enabled: false, reason: "Já está ativa." },
    budget: status !== "ACTIVE" ? { enabled: false, reason: "Só é possível alterar o orçamento de uma entidade ativa." }
      : lifetime && lifetime > 0 ? { enabled: false, reason: "Orçamento vitalício: este controle altera apenas orçamento diário." }
      : daily === null ? { enabled: false, reason: "O orçamento diário não está definido neste nível (pode ser compartilhado ou definido em outro nível)." }
      : exponent === null ? { enabled: false, reason: "Moeda da conta não reconhecida." } : { enabled: true },
  };
  if (busy) for (const op of Object.keys(ops) as ManualOp[]) ops[op] = { enabled: false, reason: "Há outra operação em andamento ou aguardando verificação nesta conta." };
  return {
    kind: "ready", level: ref.level, entityId: ref.entityId, accountName: scope.account.name, currency: scope.account.currency, exponent: exponent ?? 2,
    configuredStatus: status, effectiveStatus: typeof raw.effective_status === "string" ? raw.effective_status : null,
    dailyBudgetMinor: daily, busy, ops, checkedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
}

export type ManualRunInput = {
  ref: ManualRef; op: ManualOp; requestId: string;
  /** Estado que o usuário VIU e confirmou. Se a Meta mudou desde então, nada é enviado. */
  expected: { configuredStatus: "ACTIVE" | "PAUSED"; dailyBudgetMinor: number | null };
  dailyBudgetMinor?: number;
};

const failFromControl = (control: Blocked): ManualRunResult => ({ ok: false, code: control.kind, message: control.message, control });

/** Executa UMA operação pelo executor existente. Revalida tudo no servidor imediatamente antes: papel, escopo, estado ao vivo e orçamento. */
export async function runManualOperation(actor: Actor, input: ManualRunInput, deps: ControlDeps): Promise<ManualRunResult> {
  const { ref, op } = input;
  if (!validRef(ref) || !UUID.test(input.requestId) || !(op in MANUAL_ACTION_NAMES)) return { ok: false, code: "invalid", message: "Dados da operação inválidos." };
  const control = await resolveManualControl(actor, ref, deps);
  if (control.kind !== "ready") return failFromControl(control);
  if (control.busy) return { ok: false, code: "busy", message: "Há outra operação em andamento ou aguardando verificação nesta conta. Aguarde a conclusão.", control };
  if (!control.ops[op].enabled) return { ok: false, code: "unavailable", message: control.ops[op].reason ?? "Operação indisponível.", control };
  if (input.expected.configuredStatus !== control.configuredStatus || (op === "budget" && input.expected.dailyBudgetMinor !== control.dailyBudgetMinor)) {
    return { ok: false, code: "stale", message: "O estado na Meta mudou desde que você abriu esta tela. Confira o estado atual e confirme novamente.", control };
  }
  let budget: number | undefined;
  if (op === "budget") {
    budget = input.dailyBudgetMinor;
    if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget <= 0) return { ok: false, code: "invalid", message: "Orçamento inválido.", control };
    const check = validateBudgetChange(control.dailyBudgetMinor, budget);
    if (!check.ok) return { ok: false, code: "invalid", message: check.message, control };
  } else if (input.dailyBudgetMinor !== undefined) return { ok: false, code: "invalid", message: "Dados da operação inválidos.", control };

  const result = await (deps.request ?? requestManualMetaChange)({
    requestId: input.requestId, clientId: ref.clientId, adAccountId: ref.accountId,
    action: MANUAL_ACTION_NAMES[op][ref.level], targetId: ref.entityId, ...(budget !== undefined ? { dailyBudgetMinor: budget } : {}),
    note: "pela página de detalhes",
  });
  if (!result.ok) {
    const map: Record<string, ManualRunFailureCode> = { duplicate: "duplicate", account_busy: "busy", gate_closed: "executor_disabled", executor_disabled: "executor_disabled" };
    return { ok: false, code: map[result.code] ?? "failed", message: result.message };
  }
  if (result.execution === "verified" || result.execution === "needs_verification") {
    const fresh = await resolveManualControl(actor, ref, deps).catch(() => null);
    return { ok: true, outcome: result.execution, control: fresh, message: result.execution === "verified"
      ? "Alteração executada e confirmada na Meta." : "A Meta recebeu o pedido, mas ainda não confirmou o novo estado. A conta fica bloqueada para novas alterações até a verificação; consulte o histórico." };
  }
  if (result.execution === "failed") return { ok: false, code: "blocked", message: "A verificação de segurança bloqueou a alteração antes do envio. Nada foi alterado na Meta." };
  return { ok: false, code: "unavailable", message: "O serviço de execução não respondeu. Consulte o histórico antes de tentar novamente; nada foi confirmado." };
}

/** Histórico do ledger existente para a entidade (manual e IA). Só campos seguros; nunca justificativa, chave de idempotência ou segredos. */
export async function loadManualHistory(actor: Actor, ref: ManualRef, deps: ControlDeps, limit = 8): Promise<ManualHistoryItem[] | null> {
  const scope = await resolveScope(actor, ref, deps);
  if (!scope.ok) return null;
  const { data, error } = await deps.service.from("agent_action_jobs")
    .select("id,created_at,action_type,execution_origin,requested_by,approved_by,status,failure_code,before_state,after_state,daily_budget_minor")
    .eq("agency_id", actor.agencyId).eq("client_id", ref.clientId).eq("ad_account_id", scope.account.id).eq("meta_entity_id", ref.entityId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return null;
  const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const str = (value: unknown) => typeof value === "string" ? value : null;
  const obj = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return (data ?? []).map(job => {
    const before = obj(job.before_state), after = obj(job.after_state);
    const manual = job.execution_origin === "manual";
    return {
      id: job.id, createdAt: job.created_at, action: job.action_type, origin: manual ? "manual" : "ai",
      requestedBy: !manual ? "ai" : job.requested_by === actor.userId ? "you" : "team",
      approved: manual ? null : !!job.approved_by,
      status: job.status, failure: job.failure_code ?? null,
      previousStatus: str(before.previous_status), confirmedStatus: str(after.confirmed_status),
      previousBudgetMinor: num(before.previous_daily_budget_minor), confirmedBudgetMinor: num(after.confirmed_daily_budget_minor),
      requestedBudgetMinor: job.daily_budget_minor === null ? null : Number(job.daily_budget_minor),
    } satisfies ManualHistoryItem;
  });
}
