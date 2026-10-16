import { z } from "zod";

// Traduz a situação financeira (lida do banco, nunca da URL) no que a pessoa vê. O parâmetro "e" do retorno do checkout é só uma
// DICA de texto: não ativa nada e não muda direitos.

const dateText = z.string().nullish();
const billingSchema = z.object({
  role: z.string().nullish(), can_contract: z.boolean().nullish(),
  subscription: z.object({ status: z.string(), cycle: z.string(), amount_cents: z.number(), current_period_end: dateText, grace_ends_at: dateText, cancel_at_period_end: z.boolean().nullish(), cancel_requested_at: dateText, remote_cancel_pending: z.boolean().nullish(), next_due_date: dateText, overdue_due_date: dateText }).nullish(),
  trial: z.object({ status: z.string(), ends_at: z.string() }).nullish(),
  pending_checkout: z.object({ status: z.string(), cycle: z.string(), amount_cents: z.number(), expires_at: z.string(), verifying: z.boolean().nullish(), retry_after: dateText, checkout_url: dateText, dispatched_at: dateText }).nullish(),
  recovery: z.object({ since: z.string(), review: z.boolean().nullish() }).nullish(), conflict: z.boolean().nullish(),
  last_intent: z.object({ status: z.string(), at: dateText }).nullish(),
  last_subscription: z.object({ status: z.string(), activated: z.boolean(), canceled_at: dateText, cycle: z.string().nullish(), amount_cents: z.number().nullish() }).nullish(),
  payments: z.array(z.object({ due_date: z.string(), amount_cents: z.number(), status: z.string(), confirmed_at: dateText, invoice_url: dateText })).nullish(),
  current_plan: z.object({ name: z.string(), version: z.number(), kind: z.string(), access_state: z.string() }).nullish(),
});
export type BillingSnapshot = z.infer<typeof billingSchema>;
export function parseBillingSnapshot(value: unknown): BillingSnapshot | null {
  const parsed = billingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ContractState =
  | "idle" | "preparing" | "awaiting_payment" | "verifying_contract" | "verifying_payment" | "confirmed"
  | "past_due" | "suspended" | "refused" | "canceled" | "expired" | "temporary_error" | "unavailable" | "recovering" | "conflict" | "attention" | "canceling" | "cancel_scheduled" | "ended";
export type ReturnHint = "ok" | "cancelado" | "expirado" | null;
export type ContractView = { state: ContractState; title: string; message: string; tone: "neutral" | "info" | "good" | "warn" | "bad"; polling: boolean };

export function parseReturnHint(value: unknown): ReturnHint {
  return value === "ok" || value === "cancelado" || value === "expirado" ? value : null;
}

const time = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : null;
const day = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : null;

/**
 * Estado da contratação. Ordem de precedência: assinatura viva > contratação em andamento > última tentativa encerrada.
 * Nenhum estado "confirmado" sai de outra fonte que não a assinatura ativa registrada pelo servidor.
 */
/** Depois deste tempo sem confirmação, a tela avisa que a conferência continua em segundo plano (sem incentivar novo pagamento). */
export const SLOW_CONFIRMATION_MS = 10 * 60 * 1000;

export const ATTENTION_AFTER_MS = 24 * 60 * 60 * 1000;
const attention = (): ContractView => ({ state: "attention", title: "Contratação em análise", tone: "warn", polling: false,
  message: "Ainda não conseguimos confirmar automaticamente a sua contratação anterior. Por segurança, não abrimos outra cobrança até concluir essa conferência. Não pague de novo: fale com o suporte para a análise financeira, que preserva o seu pagamento." });
const recovering = (): ContractView => ({ state: "recovering", title: "Confirmação em andamento", tone: "info", polling: true,
  message: "Ainda estamos confirmando seu pagamento com o Asaas; isso pode levar alguns minutos. Não pague de novo: se o pagamento foi feito, o plano é liberado automaticamente assim que a confirmação chegar. Se demorar muito, fale com o suporte." });

export function deriveContractView(billing: BillingSnapshot | null, hint: ReturnHint = null, now: Date = new Date()): ContractView {
  if (!billing) return { state: "unavailable", title: "Assinatura indisponível", message: "Não foi possível consultar a situação da assinatura agora. Tente novamente em instantes.", tone: "warn", polling: false };
  if (billing.conflict) return { state: "conflict", title: "Pagamento que exige atendimento", tone: "warn", polling: false, message: "Identificamos um pagamento adicional associado à sua organização. Seu plano atual não foi alterado e nada foi cancelado ou reembolsado automaticamente. Não pague de novo: fale com o suporte para regularizar." };
  const sub = billing.subscription;
  if (sub?.status === "active" && (sub.cancel_requested_at || sub.cancel_at_period_end)) {
    const end = day(sub.current_period_end) ?? "o fim do período pago";
    // Cancelamento pedido, mas o Asaas ainda não confirmou: NÃO se afirma que a renovação foi interrompida.
    if (sub.remote_cancel_pending) return { state: "canceling", title: "Cancelamento em processamento", tone: "info", polling: true,
      message: `Recebemos o seu pedido de cancelamento e estamos concluindo-o com o Asaas. Até a confirmação, a renovação ainda não foi interrompida. Seu acesso permanece disponível até ${end}; seus dados estão preservados.` };
    return { state: "cancel_scheduled", title: "Assinatura cancelada", tone: "warn", polling: false,
      message: `Seu acesso permanece disponível até ${end}. Não haverá renovação nem novas cobranças. Seus dados foram preservados e não há reembolso automático do período pago.` };
  }
  if (sub?.status === "active") {
    const end = day(sub.current_period_end);
    return { state: "confirmed", title: "Pagamento confirmado", tone: "good", polling: false,
      message: sub.cancel_at_period_end ? `Sua assinatura está ativa até ${end ?? "o fim do período"} e não será renovada.` : `Sua assinatura está ativa${end ? ` e renova em ${end}` : ""}. Os recursos do plano já estão liberados.` };
  }
  if (sub?.status === "past_due") return { state: "past_due", title: "Pagamento em atraso", tone: "warn", polling: false, message: `Não conseguimos confirmar o pagamento da renovação. Você mantém o acesso até ${time(sub.grace_ends_at) ?? "o fim do prazo de tolerância"}; depois disso os recursos pagos ficam bloqueados (seus dados são preservados). Pagando a cobrança em aberto, o acesso normal continua automaticamente.` };
  if (sub?.status === "suspended") return { state: "suspended", title: "Assinatura suspensa", tone: "bad", polling: false, message: "O pagamento da renovação não foi regularizado dentro do prazo de tolerância. Seus dados estão preservados e você pode consultá-los, mas os recursos pagos estão bloqueados. Pagando a cobrança em aberto, os recursos voltam automaticamente; automações que ficaram sem executar não são refeitas." };
  if (sub?.status === "pending") return { state: "verifying_payment", title: "Verificando o pagamento", tone: "info", polling: true, message: "Recebemos a sua contratação e estamos confirmando o pagamento com o Asaas. Isso costuma levar poucos instantes. Você não será cobrado de novo." };

  const checkout = billing.pending_checkout;
  if (checkout) {
    if (checkout.status === "awaiting_payment") {
      if (hint === "ok") {
        const since = checkout.dispatched_at ? new Date(checkout.dispatched_at).getTime() : null;
        if (now.getTime() > new Date(checkout.expires_at).getTime() || (since !== null && now.getTime() - since > SLOW_CONFIRMATION_MS)) return recovering();
        return { state: "verifying_payment", title: "Verificando o pagamento", tone: "info", polling: true, message: "Você voltou do pagamento. Estamos confirmando com o Asaas; só liberamos o plano depois da confirmação. Não é preciso pagar de novo." };
      }
      if (hint === "cancelado") return { state: "awaiting_payment", title: "Pagamento não concluído", tone: "warn", polling: false, message: `Você saiu do pagamento antes de concluir. Você pode retomá-lo até ${time(checkout.expires_at) ?? "o prazo do checkout"}.` };
      return { state: "awaiting_payment", title: "Aguardando o pagamento", tone: "info", polling: false, message: `Seu checkout está aberto até ${time(checkout.expires_at) ?? "o prazo definido"}. Conclua o pagamento no ambiente seguro do Asaas.` };
    }
    if (checkout.status === "dispatching" || checkout.status === "unknown") return { state: "verifying_contract", title: "Verificando a contratação", tone: "info", polling: true, message: `Estamos verificando sua contratação. Não há nova cobrança enquanto isso${checkout.retry_after ? `; se não for concluída, você poderá tentar de novo depois das ${time(checkout.retry_after)}` : ""}.` };
    return { state: "preparing", title: "Preparando o pagamento", tone: "info", polling: true, message: "Estamos preparando o pagamento. Aguarde alguns instantes." };
  }

  // Contratação que expirou no relógio mas ainda está sendo conferida no Asaas (pode ter sido paga): nunca vira "expirado" nem convida a pagar de novo.
  if (billing.recovery) {
    // Sem conferência conclusiva depois de 24 h (ou com divergência para revisão): não há liberação automática de nova contratação.
    const since = new Date(billing.recovery.since).getTime();
    if (billing.recovery.review || now.getTime() - since > ATTENTION_AFTER_MS) return attention();
    return recovering();
  }
  const last = billing.last_intent;
  if (billing.last_subscription && billing.last_subscription.status === "canceled" && !billing.last_subscription.activated && last?.status === "completed") {
    return { state: "refused", title: "Pagamento não concluído", tone: "bad", polling: false, message: "O pagamento não foi aprovado e a contratação foi encerrada sem cobrança. Confira os dados do cartão ou use outro cartão e tente de novo." };
  }
  if (billing.last_subscription && billing.last_subscription.status === "canceled" && billing.last_subscription.activated && !billing.subscription) {
    const ended = day(billing.last_subscription.canceled_at);
    return { state: "ended", title: "Assinatura encerrada", tone: "neutral", polling: false,
      message: `${ended ? `Sua assinatura terminou em ${ended}. ` : "Sua assinatura terminou. "}Seus dados foram preservados; os recursos pagos ficam bloqueados até uma nova contratação.` };
  }
  if (hint === "ok" && last?.status === "expired") return { state: "expired", title: "Pagamento não localizado", tone: "warn", polling: false, message: "Não encontramos um pagamento confirmado para esta contratação e nada foi cobrado. Se você pagou, aguarde alguns minutos e atualize a página, ou fale com o suporte antes de tentar de novo." };
  if (hint === "ok") return { state: "verifying_payment", title: "Verificando o pagamento", tone: "info", polling: true, message: "Você voltou do pagamento. Estamos confirmando com o Asaas; só liberamos o plano depois da confirmação." };
  if (last?.status === "expired" || hint === "expirado") return { state: "expired", title: "Checkout expirado", tone: "warn", polling: false, message: "O tempo para pagar terminou e nada foi cobrado. Você pode iniciar uma nova contratação." };
  if (last?.status === "canceled" || hint === "cancelado") return { state: "canceled", title: "Checkout cancelado", tone: "warn", polling: false, message: "O pagamento foi cancelado e nada foi cobrado. Você pode iniciar uma nova contratação." };
  if (last?.status === "failed") return { state: "temporary_error", title: "Erro temporário", tone: "warn", polling: false, message: "Não foi possível preparar o pagamento. Nada foi cobrado. Tente novamente em instantes." };
  return { state: "idle", title: "Escolha seu plano", tone: "neutral", polling: false, message: "Escolha o plano e o período. O pagamento é feito no ambiente seguro do Asaas." };
}
