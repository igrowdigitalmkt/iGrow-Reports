import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MAX_WEBHOOK_BYTES = 64 * 1024;

/** O Asaas autentica o webhook por um token no cabeçalho (não há assinatura criptográfica do corpo). Comparação em tempo constante. */
export function validateWebhookToken(received: string | null, expected: string | null): "ok" | "invalid" | "unconfigured" {
  if (!expected) return "unconfigured";
  if (!received || received.length > 300) return "invalid";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected)) ? "ok" : "invalid";
}

const idText = z.string().regex(/^[A-Za-z0-9_-]{4,120}$/);
const eventSchema = z.object({
  id: idText,
  event: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  dateCreated: z.string().max(40).nullish(),
  payment: z.object({ id: idText, subscription: idText.nullish(), status: z.string().max(60).nullish(), value: z.number().nullish(), dueDate: z.string().max(12).nullish() }).nullish(),
  subscription: z.object({ id: idText, status: z.string().max(30).nullish() }).nullish(),
  checkout: z.object({ id: idText }).nullish(),
});

export type ParsedAsaasEvent = {
  eventId: string; eventType: string; resourceType: "payment" | "subscription" | "checkout" | "other"; resourceId: string | null;
  /** Campos úteis e nada pessoal: é isto que fica gravado. O estado real vem da API do Asaas, nunca do corpo do evento. */
  payload: Record<string, unknown>;
};

export function parseAsaasEvent(input: unknown): ParsedAsaasEvent | null {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return null;
  const e = parsed.data;
  const resourceType = e.event.startsWith("PAYMENT_") && e.payment ? "payment" : e.event.startsWith("SUBSCRIPTION_") && e.subscription ? "subscription"
    : e.event.startsWith("CHECKOUT_") && e.checkout ? "checkout" : "other";
  const resourceId = resourceType === "payment" ? e.payment!.id : resourceType === "subscription" ? e.subscription!.id : resourceType === "checkout" ? e.checkout!.id : null;
  return {
    eventId: e.id, eventType: e.event, resourceType, resourceId,
    payload: { id: e.id, event: e.event, dateCreated: e.dateCreated ?? null, payment: e.payment ?? null, subscription: e.subscription ?? null, checkout: e.checkout ?? null },
  };
}
