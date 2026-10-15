import { z } from "zod";

// Traduz a situação financeira (lida do banco, nunca da URL) no que a pessoa vê. O parâmetro "e" do retorno do checkout é só uma
// DICA de texto: não ativa nada e não muda direitos.

const dateText = z.string().nullish();
const billingSchema = z.object({
  role: z.string().nullish(), can_contract: z.boolean().nullish(),
  subscription: z.object({ status: z.string(), cycle: z.string(), amount_cents: z.number(), current_period_end: dateText, grace_ends_at: dateText, cancel_at_period_end: z.boolean().nullish() }).nullish(),
  trial: z.object({ status: z.string(), ends_at: z.string() }).nullish(),
  pending_checkout: z.object({ status: z.string(), cycle: z.string(), amount_cents: z.number(), expires_at: z.string(), verifying: z.boolean().nullish(), retry_after: dateText, checkout_url: dateText }).nullish(),
  last_intent: z.object({ status: z.string(), at: dateText }).nullish(),
  last_subscription: z.object({ status: z.string(), activated: z.boolean() }).nullish(),
  current_plan: z.object({ name: z.string(), version: z.number(), kind: z.string(), access_state: z.string() }).nullish(),
});
export type BillingSnapshot = z.infer<typeof billingSchema>;
export function parseBillingSnapshot(value: unknown): BillingSnapshot | null {
  const parsed = billingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ContractState =
  | "idle" | "preparing" | "awaiting_payment" | "verifying_contract" | "verifying_payment" | "confirmed"
  | "past_due" | "suspended" | "refused" | "canceled" | "expired" | "temporary_error" | "unavailable";
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
export function deriveContractView(billing: BillingSnapshot | null, hint: ReturnHint = null): ContractView {
  if (!billing) return { state: "unavailable", title: "Assinatura indisponível", message: "Não foi possível consultar a situação da assinatura agora. Tente novamente em instantes.", tone: "warn", polling: false };
  const sub = billing.subscription;
  if (sub?.status === "active") {
    const end = day(sub.current_period_end);
    return { state: "confirmed", title: "Pagamento confirmado", tone: "good", polling: false,
      message: sub.cancel_at_period_end ? `Sua assinatura está ativa até ${end ?? "o fim do período"} e não será renovada.` : `Sua assinatura está ativa${end ? ` e renova em ${end}` : ""}. Os recursos do plano já estão liberados.` };
  }
  if (sub?.status === "past_due") return { state: "past_due", title: "Pagamento em atraso", tone: "warn", polling: false, message: `Não conseguimos cobrar a renovação. Você mantém o acesso até ${time(sub.grace_ends_at) ?? "o fim do prazo de tolerância"}; depois disso os recursos pagos ficam bloqueados (seus dados são preservados).` };
  if (sub?.status === "suspended") return { state: "suspended", title: "Assinatura suspensa", tone: "bad", polling: false, message: "O pagamento não foi regularizado. Seus dados estão preservados e você pode consultá-los, mas novas operações pagas estão bloqueadas até a regularização." };
  if (sub?.status === "pending") return { state: "verifying_payment", title: "Verificando o pagamento", tone: "info", polling: true, message: "Recebemos a sua contratação e estamos confirmando o pagamento com o Asaas. Isso costuma levar poucos instantes. Você não será cobrado de novo." };

  const checkout = billing.pending_checkout;
  if (checkout) {
    if (checkout.status === "awaiting_payment") {
      if (hint === "ok") return { state: "verifying_payment", title: "Verificando o pagamento", tone: "info", polling: true, message: "Você voltou do pagamento. Estamos confirmando com o Asaas; só liberamos o plano depois da confirmação. Não é preciso pagar de novo." };
      if (hint === "cancelado") return { state: "awaiting_payment", title: "Pagamento não concluído", tone: "warn", polling: false, message: `Você saiu do pagamento antes de concluir. Você pode retomá-lo até ${time(checkout.expires_at) ?? "o prazo do checkout"}.` };
      return { state: "awaiting_payment", title: "Aguardando o pagamento", tone: "info", polling: false, message: `Seu checkout está aberto até ${time(checkout.expires_at) ?? "o prazo definido"}. Conclua o pagamento no ambiente seguro do Asaas.` };
    }
    if (checkout.status === "dispatching" || checkout.status === "unknown") return { state: "verifying_contract", title: "Verificando a contratação", tone: "info", polling: true, message: `Estamos verificando sua contratação. Não há nova cobrança enquanto isso${checkout.retry_after ? `; se não for concluída, você poderá tentar de novo depois das ${time(checkout.retry_after)}` : ""}.` };
    return { state: "preparing", title: "Preparando o pagamento", tone: "info", polling: true, message: "Estamos preparando o pagamento. Aguarde alguns instantes." };
  }

  const last = billing.last_intent;
  if (billing.last_subscription && billing.last_subscription.status === "canceled" && !billing.last_subscription.activated && last?.status === "completed") {
    return { state: "refused", title: "Pagamento não concluído", tone: "bad", polling: false, message: "O pagamento não foi aprovado e a contratação foi encerrada sem cobrança. Confira os dados do cartão ou use outro cartão e tente de novo." };
  }
  if (hint === "ok") return { state: "verifying_payment", title: "Verificando o pagamento", tone: "info", polling: true, message: "Você voltou do pagamento. Estamos confirmando com o Asaas; só liberamos o plano depois da confirmação." };
  if (last?.status === "expired" || hint === "expirado") return { state: "expired", title: "Checkout expirado", tone: "warn", polling: false, message: "O tempo para pagar terminou e nada foi cobrado. Você pode iniciar uma nova contratação." };
  if (last?.status === "canceled" || hint === "cancelado") return { state: "canceled", title: "Checkout cancelado", tone: "warn", polling: false, message: "O pagamento foi cancelado e nada foi cobrado. Você pode iniciar uma nova contratação." };
  if (last?.status === "failed") return { state: "temporary_error", title: "Erro temporário", tone: "warn", polling: false, message: "Não foi possível preparar o pagamento. Nada foi cobrado. Tente novamente em instantes." };
  return { state: "idle", title: "Escolha seu plano", tone: "neutral", polling: false, message: "Escolha o plano e o período. O pagamento é feito no ambiente seguro do Asaas." };
}
