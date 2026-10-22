import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { aiCreditsView, type AiCreditsView } from "./credits";
import { DEFAULT_MONTHLY_BUDGET_USD } from "./defaults";
import { parseAiEntitlement } from "./entitlement";
import { aiAvailability } from "./usage-summary";

/**
 * Consumo de créditos de IA do mês da organização, visível a qualquer membro (o custo em dólar e as linhas de uso continuam só para
 * administradores). Mesma regra da IA: orçamento da organização limitado pelo teto do plano; o consumo é o total comprometido do mês
 * (liquidado + reservado + desconhecido), que é o que o banco usa para recusar novas chamadas.
 * Retorna null quando não dá para calcular (o contador some em vez de mostrar um número errado).
 */
export async function loadAiCredits(agencyId: string): Promise<AiCreditsView | null> {
  const service = createSupabaseServiceClient();
  if (!service) return null;
  try {
    const [settings, cost, entitlement] = await Promise.all([
      service.from("ai_settings").select("monthly_budget_usd").eq("agency_id", agencyId).maybeSingle(),
      service.rpc("ai_month_cost", { p_agency_id: agencyId }),
      service.rpc("agency_ai_entitlement", { p_agency_id: agencyId }),
    ]);
    const commercialMissing = entitlement.error?.code === "PGRST202" || entitlement.error?.code === "42883";
    const commercial = commercialMissing ? { allowed: true, budgetUsd: null } : parseAiEntitlement(entitlement.data);
    if (settings.error || cost.error || cost.data == null || (entitlement.error && !commercialMissing) || !commercial) return null;
    const configured = Number(settings.data?.monthly_budget_usd ?? commercial.budgetUsd ?? DEFAULT_MONTHLY_BUDGET_USD);
    const budgetUsd = commercial.allowed ? aiAvailability(configured, commercial.budgetUsd, Number(cost.data)).effectiveBudgetUsd : 0;
    return aiCreditsView({ budgetUsd, costUsd: Number(cost.data) });
  } catch {
    return null;
  }
}
