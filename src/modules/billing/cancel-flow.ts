import "server-only";
import { cancelSubscriptionRequest } from "./contracting";
import type { BillingDeps } from "./event-processor";

export type CancelActionResult =
  | { status: "canceled" | "processing"; message: string }
  | { status: "error"; message: string };

const brasiliaDay = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/**
 * Cancelamento pedido pelo PROPRIETÁRIO (conferido aqui e de novo no banco). Separa conceitos:
 *  - o pedido é gravado ANTES de falar com o Asaas (auditado, idempotente: repetir ou clicar duas vezes não duplica nada);
 *  - "cancelado" (renovação interrompida) só é dito depois que o Asaas confirmou; sem confirmação a mensagem é "em processamento" e a
 *    reconciliação repete o aviso ao Asaas;
 *  - o acesso ao período JÁ PAGO não muda; dados e configurações nunca são apagados; não há reembolso automático.
 */
export async function runCancel(deps: BillingDeps, input: { agencyId: string; userId: string; role: string }): Promise<CancelActionResult> {
  if (input.role !== "owner") return { status: "error", message: "Somente o proprietário da organização pode cancelar a assinatura." };
  const result = await cancelSubscriptionRequest(deps, { agencyId: input.agencyId, userId: input.userId });
  if (result.status === "rejected") {
    if (result.reason === "forbidden") return { status: "error", message: "Somente o proprietário da organização pode cancelar a assinatura." };
    if (result.reason === "none") return { status: "error", message: "Não há assinatura ativa para cancelar." };
    return { status: "error", message: "Não foi possível registrar o cancelamento agora. Nada foi alterado; tente novamente em instantes." };
  }
  const until = result.effectiveAt ? brasiliaDay(result.effectiveAt) : null;
  const access = until ? `Seu acesso permanece disponível até ${until}.` : "Como o pagamento ainda não tinha sido confirmado, nada foi cobrado.";
  if (result.remoteCancel === "done") return { status: "canceled", message: `Assinatura cancelada. ${access} Não haverá renovação nem novas cobranças, seus dados foram preservados e não há reembolso automático.` };
  return { status: "processing", message: `Recebemos o seu pedido de cancelamento e estamos concluindo-o com o Asaas. ${access} Até a confirmação, a renovação ainda não foi interrompida; não é preciso repetir o pedido.` };
}
