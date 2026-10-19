import "server-only";
import { getMetaApiConfig } from "@/lib/env";
import { MetaClient, type MetaBudgetEntity, type MetaFetch } from "@/modules/meta/client";

/**
 * Inventario financeiro de uma conta: soma dos orcamentos DIARIOS que podem gastar agora.
 * Conservador: qualquer entidade potencialmente ativa cujo orcamento diario nao possa ser
 * provado (vitalicio, ausente, malformado) torna a cobertura incompleta, e a politica nega.
 */
export type BudgetInventory = {
  confirmedActiveDailyBudgetMinor: number | null;
  coverageComplete: boolean;
  /** Codigos curtos (sem dados do cliente) do motivo da cobertura incompleta. */
  gaps: string[];
};

const OFF = new Set(["PAUSED", "ARCHIVED", "DELETED"]);
const live = (e: MetaBudgetEntity) => !OFF.has(String(e.status ?? "").toUpperCase());
function amount(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "" || value === "0" || value === 0) return null;
  if (typeof value === "string" && /^[1-9]\d{0,14}$/.test(value)) return Number(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  return "invalid";
}

export function computeBudgetInventory(input: { campaigns: MetaBudgetEntity[]; adsets: MetaBudgetEntity[] }, now: Date): BudgetInventory {
  const gaps = new Set<string>();
  let total = 0;
  const add = (value: number) => { total += value; if (!Number.isSafeInteger(total)) gaps.add("overflow"); };
  const byCampaign = new Map<string, MetaBudgetEntity[]>();
  for (const adset of input.adsets) {
    if (typeof adset.campaign_id !== "string") { if (live(adset)) gaps.add("adset_without_campaign"); continue; }
    byCampaign.set(adset.campaign_id, [...(byCampaign.get(adset.campaign_id) ?? []), adset]);
  }
  const known = new Set(input.campaigns.map(c => c.id));
  for (const id of byCampaign.keys()) if (!known.has(id)) gaps.add("orphan_adset");

  for (const campaign of input.campaigns) {
    if (!live(campaign)) continue;
    const cDaily = amount(campaign.daily_budget), cLife = amount(campaign.lifetime_budget);
    if (cDaily === "invalid" || cLife === "invalid") { gaps.add("invalid_budget"); continue; }
    if (cLife !== null) { gaps.add("lifetime_budget"); continue; }
    if (cDaily !== null) { add(cDaily); continue; } // orcamento da campanha cobre os conjuntos
    for (const adset of byCampaign.get(campaign.id) ?? []) {
      if (!live(adset)) continue;
      if (adset.end_time && Date.parse(adset.end_time) <= now.getTime()) continue; // encerrado
      const daily = amount(adset.daily_budget), life = amount(adset.lifetime_budget);
      if (daily === "invalid" || life === "invalid") gaps.add("invalid_budget");
      else if (life !== null) gaps.add("lifetime_budget");
      else if (daily === null) gaps.add("missing_budget");
      else add(daily);
    }
  }
  const complete = gaps.size === 0;
  return { confirmedActiveDailyBudgetMinor: complete ? total : null, coverageComplete: complete, gaps: [...gaps].sort() };
}

/** Le o inventario na Meta (somente GET). Qualquer falha => cobertura incompleta. */
export async function readBudgetInventory(
  token: string, adAccountId: string, deps: { apiVersion?: string; fetchImpl?: MetaFetch; now?: () => Date } = {},
): Promise<BudgetInventory> {
  const apiVersion = deps.apiVersion ?? getMetaApiConfig()?.apiVersion;
  const failed: BudgetInventory = { confirmedActiveDailyBudgetMinor: null, coverageComplete: false, gaps: ["read_failed"] };
  if (!apiVersion || !token.trim()) return failed;
  try {
    const client = new MetaClient({ accessToken: token, apiVersion, fetchImpl: deps.fetchImpl, timeoutMs: 25_000, retryDelayMs: 1_000 });
    return computeBudgetInventory(await client.listBudgetInventory(adAccountId), deps.now?.() ?? new Date());
  } catch { return failed; }
}
