import { z } from "zod";
export const recipientInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do destinatário.").max(120),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use o formato internacional: +, país, DDD e número, sem espaços."),
  active: z.boolean(),
});
export const consentInputSchema = z.object({
  granted: z.boolean(),
  source: z.string().trim().min(2, "Informe a origem ou motivo do registro.").max(1000),
  occurredAt: z.iso.datetime({ offset: true }).nullable(),
}).superRefine((value, ctx) => {
  if (value.granted && (!value.occurredAt || Date.parse(value.occurredAt) > Date.now() || Date.parse(value.occurredAt) < Date.parse("2000-01-01"))) ctx.addIssue({ code: "custom", message: "Informe a data da autorização, sem usar uma data futura." });
});
export type Recipient = { id: string; name: string; phone: string; active: boolean; consent_status: "pending" | "granted" | "revoked"; consent_at: string | null; consent_source: string | null; unsubscribed_at: string | null };
export type ConsentEvent = { id: string; recipient_id: string; event_type: string; phone: string; source: string; occurred_at: string; recorded_at: string; actor_id: string | null };
export type RecipientData = { recipients: Recipient[]; events: ConsentEvent[] };
export type RecipientResult = RecipientData | { error: string };
