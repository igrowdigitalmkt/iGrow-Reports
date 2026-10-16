import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getAgencyBillingAccess, type BillingAccessState } from "./access";

// Trava única das operações PAGAS que geram custo ou efeito externo (envio manual de WhatsApp, novos relatórios, novas sincronizações com
// anúncios). Reutiliza o controle financeiro central (`agency_billing_restricted`): organização sem plano, com concessão administrativa
// ou em dia/tolerância passa; suspensa, encerrada ou teste finalizado é barrada NO SERVIDOR, antes de qualquer chamada externa.
// Leitura de dados e relatórios já existentes nunca passa por aqui.

export const PAID_OPERATION_RESTRICTED_MESSAGE =
  "Operação indisponível: o acesso desta organização está restrito (assinatura suspensa, encerrada ou teste finalizado). Seus dados, relatórios e conversas continuam disponíveis para consulta. Regularize em Assinatura.";
export const PAID_OPERATION_UNVERIFIED_MESSAGE =
  "Não foi possível confirmar o plano da organização agora; por segurança a operação não foi realizada. Tente novamente em instantes.";

export class BillingRestrictedError extends Error {
  constructor(readonly reason: "restricted" | "unverified") {
    super(reason === "restricted" ? PAID_OPERATION_RESTRICTED_MESSAGE : PAID_OPERATION_UNVERIFIED_MESSAGE);
    this.name = "BillingRestrictedError";
  }
}

export type AccessChecker = (agencyId: string) => Promise<BillingAccessState>;

const defaultChecker: AccessChecker = async agencyId => {
  const service = createSupabaseServiceClient();
  // Sem como consultar o financeiro não se executa: nunca se libera "por padrão".
  return service ? getAgencyBillingAccess(service, agencyId) : "unknown";
};

/** Lança BillingRestrictedError quando a organização não pode executar operações pagas. */
export async function ensurePaidOperation(agencyId: string, check: AccessChecker = defaultChecker): Promise<void> {
  const access = await check(agencyId);
  if (access === "restricted") throw new BillingRestrictedError("restricted");
  if (access === "unknown") throw new BillingRestrictedError("unverified");
}

export type PaidOperationBlock = { status: 403 | 503; error: string; code: "billing_restricted" | "billing_unverified" };

export function billingBlockOf(error: unknown): PaidOperationBlock | null {
  if (!(error instanceof BillingRestrictedError)) return null;
  return error.reason === "restricted"
    ? { status: 403, error: PAID_OPERATION_RESTRICTED_MESSAGE, code: "billing_restricted" }
    : { status: 503, error: PAID_OPERATION_UNVERIFIED_MESSAGE, code: "billing_unverified" };
}

/** Forma simples para rotas e ações: devolve o bloqueio (ou null quando liberado). */
export async function paidOperationBlock(agencyId: string, check?: AccessChecker): Promise<PaidOperationBlock | null> {
  try {
    await ensurePaidOperation(agencyId, check);
    return null;
  } catch (error) {
    const block = billingBlockOf(error);
    if (block) return block;
    throw error;
  }
}
