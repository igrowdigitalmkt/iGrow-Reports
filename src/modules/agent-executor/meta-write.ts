import "server-only";
import { evaluateDelegatedAction, type PolicyInput, type AuthorizedOperation } from "./policy";

/**
 * Adaptador de escrita ISOLADO. Não conectado a nenhuma rota, job ou usuário.
 * A fonte dos vínculos/permissões/contexto precisa ser o banco (server-only).
 * Nunca enviar token, payload Graph ou mensagem de erro externa para o modelo.
 */
type MetaWriteDeps = { fetchImpl?: typeof fetch; now?: () => Date };
type ExecuteInput = Omit<PolicyInput, "now" | "entity"> & {
  token: string;
  apiVersion: string;
  /** O identificador Meta da entidade, resolvido pelo servidor. */
  targetId: string;
};

type EntityRead = { id?: unknown; account_id?: unknown; status?: unknown; daily_budget?: unknown; objective?: unknown; campaign_id?: unknown; error?: unknown };
export type MetaWriteResult =
  | { status: "blocked"; reason: string }
  | { status: "verified"; actionId: string; metaEntityId: string }
  | { status: "needs_verification"; actionId: string; metaEntityId: string; detail: string };

function normalizeAccountId(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:act_)?[1-9]\d*$/.test(value)) return null;
  return value.startsWith("act_") ? value : `act_${value}`;
}
function readEntity(raw: EntityRead, targetId: string, accountId: string, level: "campaign" | "adset", now: Date) {
  if (raw.id !== targetId || normalizeAccountId(raw.account_id) !== accountId) return null;
  // Validar o tipo pelo campo real do provedor; jamais deduzir o tipo somente do pedido da IA.
  if (level === "campaign" && (typeof raw.objective !== "string" || !raw.objective)) return null;
  if (level === "adset" && (typeof raw.campaign_id !== "string" || !/^[1-9]\d*$/.test(raw.campaign_id))) return null;
  const status = raw.status;
  if (typeof status !== "string") return null;
  const daily = raw.daily_budget;
  // Zero e ausência são distintos; não preencher valores desconhecidos.
  const minor = typeof daily === "string" && /^\d+$/.test(daily) ? Number(daily)
    : typeof daily === "number" ? daily : null;
  if (minor !== null && (!Number.isSafeInteger(minor) || minor < 0)) return null;
  return { id: targetId, adAccountId: accountId, configuredStatus: status,
    dailyBudgetMinor: minor, fetchedAt: now.toISOString() };
}
function expectedStatus(op: AuthorizedOperation) {
  return op.action.startsWith("pause_") ? "PAUSED" : op.action.startsWith("resume_") ? "ACTIVE" : op.previousStatus;
}
function verified(op: AuthorizedOperation, raw: EntityRead) {
  if (raw.status !== expectedStatus(op)) return false;
  if (op.requestedDailyBudgetMinor !== null) {
    const value = raw.daily_budget;
    const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    return parsed === op.requestedDailyBudgetMinor;
  }
  return true;
}

/**
 * Uma execução = GET preflight → política → POST → GET confirmação.
 * NÃO repete POST se a rede/Graph falhar depois do envio. O futuro ledger
 * deverá reconciliar o resultado antes de qualquer nova tentativa.
 */
export async function executeMetaWrite(input: ExecuteInput, deps: MetaWriteDeps = {}): Promise<MetaWriteResult> {
  const fetcher = deps.fetchImpl ?? fetch, clock = deps.now ?? (() => new Date());
  const proposal = input.proposal as Record<string, unknown> | null;
  if (!proposal || typeof proposal !== "object" || proposal.targetId !== input.targetId
    || !/^[1-9]\d*$/.test(input.targetId)
    || !/^v\d+\.\d+$/.test(input.apiVersion)
    || !input.token?.trim()) return { status: "blocked", reason: "Parâmetros inválidos." };

  const account = input.context as { adAccountId?: unknown } | null;
  if (!account || typeof account.adAccountId !== "string" || !/^act_[1-9]\d*$/.test(account.adAccountId)) {
    return { status: "blocked", reason: "Conta inválida." };
  }

  const base = `https://graph.facebook.com/${input.apiVersion}/${input.targetId}`;
  const query = new URL(base);
  const expectedLevel = String(proposal.action).includes("campaign") ? "campaign" : "adset";
  query.searchParams.set("fields", expectedLevel === "campaign"
    ? "id,account_id,status,daily_budget,objective"
    : "id,account_id,status,daily_budget,campaign_id");
  const headers = { Authorization: `Bearer ${input.token}`, Accept: "application/json" };

  async function get(): Promise<EntityRead> {
    const response = await fetcher(query, { method: "GET", headers, signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível consultar o estado da entidade.");
    const value = await response.json() as EntityRead;
    if (value.error || !value.id) throw new Error("Estado Meta indisponível.");
    return value;
  }

  let before: EntityRead;
  try { before = await get(); } catch { return { status: "blocked", reason: "Estado da Meta indisponível." }; }
  const entity = readEntity(before, input.targetId, account.adAccountId, expectedLevel, clock());
  if (!entity) return { status: "blocked", reason: "Entidade não pertence à conta ou está inválida." };

  const decision = evaluateDelegatedAction({ ...input, entity: { ...entity, level: expectedLevel }, now: clock() });
  if (!decision.ok) return { status: "blocked", reason: decision.reason };
  const op = decision.operation;

  const form = new URLSearchParams();
  if (op.action.startsWith("pause_")) form.set("status", "PAUSED");
  else if (op.action.startsWith("resume_")) form.set("status", "ACTIVE");
  else if (op.requestedDailyBudgetMinor !== null) form.set("daily_budget", String(op.requestedDailyBudgetMinor));
  else return { status: "blocked", reason: "Operação não suportada." };

  let response: Response;
  try {
    response = await fetcher(new URL(base), {
      method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: form, signal: AbortSignal.timeout(15000), cache: "no-store",
    });
  } catch {
    return { status: "needs_verification", actionId: op.actionId, metaEntityId: op.targetId,
      detail: "Resultado desconhecido após o envio; consultar o estado antes de nova tentativa." };
  }
  if (!response.ok) {
    return { status: "needs_verification", actionId: op.actionId, metaEntityId: op.targetId,
      detail: "A Meta não confirmou a alteração; não repetir automaticamente." };
  }
  try {
    const after = await get();
    if (after.id === op.targetId && normalizeAccountId(after.account_id) === op.adAccountId && verified(op, after)) {
      return { status: "verified", actionId: op.actionId, metaEntityId: op.targetId };
    }
  } catch { /* envio aceito; confirmação indisponível */ }
  return { status: "needs_verification", actionId: op.actionId, metaEntityId: op.targetId,
    detail: "Aguardando confirmação do estado na Meta; não reenviar automaticamente." };
}
