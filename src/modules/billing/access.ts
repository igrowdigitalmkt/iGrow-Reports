import "server-only";

type RpcClient = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string | null; message: string } | null }> };

/** Estado financeiro da organização para fins de execução. "unknown" = não foi possível determinar com segurança. */
export type BillingAccessState = "allowed" | "restricted" | "unknown";

export const RESTRICTED_RUN_MESSAGE =
  "Envio não realizado: o acesso desta organização está restrito (assinatura suspensa, encerrada ou teste finalizado). Regularize em Assinatura. Os agendamentos, os dados e as configurações foram preservados; envios perdidos durante a restrição não são refeitos.";
export const UNVERIFIED_RUN_MESSAGE =
  "Falha temporária: não foi possível confirmar o plano da organização, então o envio não foi realizado por segurança. Os agendamentos e os dados foram preservados. Tente novamente em instantes.";
/** Quanto tempo um horário agendado aguarda a verificação voltar a funcionar antes de ser registrado como falha e descartado (sem refazer depois). */
export const UNVERIFIED_RETRY_WINDOW_MS = 60 * 60 * 1000;

/**
 * Consulta no MOMENTO DA EXECUÇÃO o estado financeiro da organização:
 *  - "allowed": comprovadamente sem restrição (sem plano/assinatura, concessão, assinatura em dia) — comportamento atual preservado;
 *  - "restricted": teste vencido, assinatura suspensa ou encerrada — nada pago é executado;
 *  - "unknown": a consulta falhou ou devolveu algo inesperado — NÃO se executa por segurança (nem se libera tudo).
 * A única exceção que libera: a função ainda não existe no banco (migration não aplicada). Nesse ambiente nenhuma organização
 * pode ter assinatura, então "sem assinatura" é um fato, não um palpite.
 */
export async function getAgencyBillingAccess(service: unknown, agencyId: string): Promise<BillingAccessState> {
  try {
    const { data, error } = await (service as RpcClient).rpc("agency_billing_restricted", { p_agency_id: agencyId });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") return "allowed";
      console.warn("billing-access-check-failed");
      return "unknown";
    }
    if (data === true) return "restricted";
    if (data === false) return "allowed";
    console.warn("billing-access-check-unexpected");
    return "unknown";
  } catch {
    console.warn("billing-access-check-failed");
    return "unknown";
  }
}
