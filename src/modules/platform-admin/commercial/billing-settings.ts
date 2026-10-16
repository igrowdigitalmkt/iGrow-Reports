import { z } from "zod";

// Leitura das configurações comerciais e do acompanhamento financeiro do Super Admin (funções do banco, só operador com MFA).
// As funções novas ainda não constam nos tipos gerados do banco: o acesso passa por esta fina camada validada.
type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
export const adminRpc = (client: unknown) => (name: string, args?: Record<string, unknown>) => (client as Rpc).rpc(name, args);

const entitlement = z.object({ key: z.string(), enabled: z.boolean().nullable().optional(), limit: z.number().nullable(), unlimited: z.boolean() });

export const billingSettingsSchema = z.object({
  trial_days: z.number(), past_due_grace_days: z.number(), checkout_minutes: z.number(), live_enabled: z.boolean(),
  trial_plan_version_id: z.string().nullable(),
  trial_plan: z.object({ plan_id: z.string(), plan_name: z.string(), version: z.number(), visibility: z.string(), sellable: z.boolean(), entitlements: z.array(entitlement) }).nullable(),
  trial_candidates: z.array(z.object({ version_id: z.string(), plan_id: z.string(), label: z.string() })),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

const cron = z.object({
  ok: z.boolean(), flags: z.array(z.string()), last_run_at: z.string().nullable(), last_run_status: z.string().nullable(), last_success_at: z.string().nullable(),
  minutes_since_success: z.number().nullable(), consecutive_non_success: z.number(), runs_last_hour: z.number(),
  backlog: z.object({ events_pending: z.number(), oldest_pending_event_minutes: z.number(), events_needing_review: z.number(), subscriptions_not_reconciled: z.number(), intents_expired_unresolved: z.number() }),
});
export const billingDashboardSchema = z.object({
  environment: z.string(), live_enabled: z.boolean(),
  subscriptions: z.object({ pending: z.number(), active: z.number(), past_due: z.number(), suspended: z.number(), canceled: z.number(), cancel_scheduled: z.number() }),
  trials: z.object({ active: z.number(), ending_in_3_days: z.number(), expired: z.number() }),
  events: z.object({ pending: z.number(), needs_review: z.number(), oldest_pending_at: z.string().nullable() }),
  attention: z.array(z.object({ agency_id: z.string(), agency_name: z.string(), status: z.string(), cycle: z.string(), amount_cents: z.number(), current_period_end: z.string().nullable(),
    grace_ends_at: z.string().nullable(), cancel_at_period_end: z.boolean(), remote_cancel_pending: z.boolean(), attention_reason: z.string().nullable() })),
  cron,
  ai: z.object({ month_cost_usd: z.number(), organizations_with_usage: z.number() }),
});
export type BillingDashboard = z.infer<typeof billingDashboardSchema>;

/** Campos do formulário -> parâmetros da função (validação final é do banco). */
export const billingSettingsFormSchema = z.object({
  trialDays: z.coerce.number().int().min(1, "A duração do teste vai de 1 a 90 dias.").max(90, "A duração do teste vai de 1 a 90 dias."),
  graceDays: z.coerce.number().int().min(0, "A tolerância vai de 0 a 60 dias.").max(60, "A tolerância vai de 0 a 60 dias."),
  checkoutMinutes: z.coerce.number().int().min(10, "A validade do checkout vai de 10 a 1440 minutos.").max(1440, "A validade do checkout vai de 10 a 1440 minutos."),
  trialPlanVersionId: z.union([z.literal(""), z.string().uuid()]).transform(value => (value === "" ? null : value)),
});

export const ENTITLEMENT_LABELS: Record<string, string> = {
  clients: "Clientes", ad_accounts: "Contas de anúncio", team_members: "Integrantes da equipe", whatsapp_numbers: "Números oficiais de WhatsApp",
  report_automations: "Automações", ai_budget_usd_cents: "Orçamento mensal de IA", ai_assistant: "Inteligência artificial", client_portal: "Portal do cliente",
};
export const limitOf = (entitlements: { key: string; limit: number | null; unlimited: boolean }[] | undefined, key: string) => {
  const row = entitlements?.find(item => item.key === key);
  return row?.unlimited ? "ilimitado" : row?.limit ?? 0;
};
