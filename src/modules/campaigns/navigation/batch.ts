import type { CampaignRow } from "../tree";
import type { ManualOp, ManualRunResult } from "../manual/contracts";

/**
 * Operações em LOTE (pausar/retomar campanhas e conjuntos). Cada entidade é uma operação independente no ledger existente
 * (`runManualOperationAction`): própria idempotência, revalidação no servidor, preflight, confirmação e auditoria. Não há atomicidade no
 * provedor, então o resultado é sempre por entidade. O banco permite uma mutação não resolvida por conta; por isso o lote é sequencial e
 * uma conta com resultado desconhecido NÃO recebe novos envios (nada é repetido automaticamente).
 */
export const BATCH_MAX = 20;
export type BatchOp = Extract<ManualOp, "pause" | "resume">;

export type BatchItem = { key: string; row: CampaignRow; compatible: boolean; reason?: string };
export type BatchPlan = { items: BatchItem[]; compatible: BatchItem[]; incompatible: BatchItem[]; accounts: string[]; tooMany: boolean };

const wanted = (op: BatchOp) => op === "pause" ? "ACTIVE" : "PAUSED";

/** Separa o que o lote pode tentar do que já se sabe incompatível. O servidor revalida cada item de qualquer forma. */
export function planBatch(op: BatchOp, rows: CampaignRow[], keyOf: (row: CampaignRow) => string): BatchPlan {
  const items = rows.map((row): BatchItem => {
    const key = keyOf(row);
    const configured = row.state.configured?.code ?? null;
    if (!configured) return { key, row, compatible: false, reason: "Estado atual não confirmado na Meta." };
    if (configured !== "ACTIVE" && configured !== "PAUSED") return { key, row, compatible: false, reason: `Estado ${row.state.configured?.label ?? configured} não permite esta operação.` };
    if (configured !== wanted(op)) return { key, row, compatible: false, reason: op === "pause" ? "Já está pausada." : "Já está ativa." };
    return { key, row, compatible: true };
  });
  const compatible = items.filter(item => item.compatible);
  return { items, compatible, incompatible: items.filter(item => !item.compatible), accounts: [...new Set(rows.map(row => row.accountName))], tooMany: compatible.length > BATCH_MAX };
}

export type BatchOutcome =
  | { key: string; status: "verified"; message: string }
  | { key: string; status: "needs_verification"; message: string }
  | { key: string; status: "failed"; message: string }
  | { key: string; status: "skipped"; message: string };
export type BatchRunner = (input: {
  ref: { clientId: string; accountId: string; level: "campaign" | "adset" | "ad"; entityId: string }; op: ManualOp; requestId: string;
  expected: { configuredStatus: "ACTIVE" | "PAUSED"; dailyBudgetMinor: number | null };
}) => Promise<ManualRunResult>;

/** Executa o lote em sequência. Para uma conta, resultado desconhecido ou conta ocupada interrompe as demais entidades dessa conta. */
export async function runBatch(input: {
  clientId: string; op: BatchOp; items: BatchItem[]; runner: BatchRunner; newRequestId: () => string; onProgress?: (outcome: BatchOutcome) => void;
}): Promise<BatchOutcome[]> {
  const outcomes: BatchOutcome[] = [];
  const blocked = new Set<string>();
  const push = (outcome: BatchOutcome) => { outcomes.push(outcome); input.onProgress?.(outcome); };
  for (const item of input.items.slice(0, BATCH_MAX)) {
    const { row } = item;
    if (blocked.has(row.accountId)) { push({ key: item.key, status: "skipped", message: "Não enviada: a conta tem uma alteração aguardando verificação ou em andamento." }); continue; }
    try {
      const result = await input.runner({
        ref: { clientId: input.clientId, accountId: row.accountId, level: row.level, entityId: row.id }, op: input.op, requestId: input.newRequestId(),
        expected: { configuredStatus: wanted(input.op), dailyBudgetMinor: null },
      });
      if (result.ok) {
        if (result.outcome === "needs_verification") blocked.add(row.accountId);
        push({ key: item.key, status: result.outcome, message: result.message });
      } else {
        // Conta ocupada ou serviço sem resposta: o resultado pode ser desconhecido, então a conta não recebe novos envios neste lote.
        if (result.code === "busy" || result.code === "unavailable") blocked.add(row.accountId);
        push({ key: item.key, status: "failed", message: result.message });
      }
    } catch {
      blocked.add(row.accountId);
      push({ key: item.key, status: "failed", message: "Não foi possível confirmar o resultado. Consulte o histórico antes de tentar novamente." });
    }
  }
  for (const item of input.items.slice(BATCH_MAX)) push({ key: item.key, status: "skipped", message: `Fora do limite de ${BATCH_MAX} entidades por lote.` });
  return outcomes;
}

export function summarizeBatch(outcomes: BatchOutcome[]) {
  const count = (status: BatchOutcome["status"]) => outcomes.filter(item => item.status === status).length;
  return { verified: count("verified"), uncertain: count("needs_verification"), failed: count("failed"), skipped: count("skipped") };
}
