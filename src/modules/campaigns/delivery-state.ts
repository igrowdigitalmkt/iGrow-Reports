import type { LiveDeliveryState } from "@/modules/meta/delivery";

/** Grupos do filtro. Cada entidade pertence a exatamente um, definido pelo estado EFETIVO informado pela Meta. */
export type DeliveryGroup = "active" | "paused" | "review" | "rejected" | "other" | "unavailable";
export type DeliveryTone = "good" | "warn" | "bad" | "neutral";
export type StateText = { code: string; label: string };
export type Restriction = { key: "account" | "issues" | "no_delivery"; label: string; detail: string };
export type DeliveryState = {
  group: DeliveryGroup; label: string; tone: DeliveryTone;
  /** Escolha do anunciante (campo status). */
  configured: StateText | null;
  /** Estado calculado pela Meta (effective_status). null quando a leitura ao vivo não o trouxe. */
  effective: StateText | null;
  /** Condições que impedem ou ameaçam a entrega; nunca substituem o estado acima. */
  restrictions: Restriction[];
  detail: string;
  /** Criação da entidade na Meta (ISO), quando a leitura ao vivo a trouxe. */
  createdAt?: string | null;
};

export const DELIVERY_GROUPS: ReadonlyArray<{ key: DeliveryGroup; label: string }> = [
  { key: "active", label: "Ativo" }, { key: "paused", label: "Pausado" }, { key: "review", label: "Em análise" },
  { key: "rejected", label: "Reprovado ou com problemas" }, { key: "other", label: "Outros estados" }, { key: "unavailable", label: "Indisponível" },
];

type Known = { group: DeliveryGroup; label: string; tone: DeliveryTone };
// Códigos documentados da Marketing API → texto em português. Códigos fora desta lista nunca são reclassificados.
const KNOWN: Record<string, Known> = {
  ACTIVE: { group: "active", label: "Ativo", tone: "good" },
  PAUSED: { group: "paused", label: "Pausado", tone: "neutral" },
  CAMPAIGN_PAUSED: { group: "paused", label: "Campanha pausada", tone: "neutral" },
  ADSET_PAUSED: { group: "paused", label: "Conjunto pausado", tone: "neutral" },
  PENDING_REVIEW: { group: "review", label: "Em análise", tone: "warn" },
  IN_PROCESS: { group: "review", label: "Em processamento", tone: "warn" },
  PREAPPROVED: { group: "review", label: "Pré-aprovado", tone: "warn" },
  DISAPPROVED: { group: "rejected", label: "Reprovado", tone: "bad" },
  WITH_ISSUES: { group: "rejected", label: "Com problemas", tone: "bad" },
  PENDING_BILLING_INFO: { group: "other", label: "Pendência de pagamento", tone: "bad" },
  ARCHIVED: { group: "other", label: "Arquivado", tone: "neutral" },
  DELETED: { group: "other", label: "Excluído", tone: "neutral" },
  ADSET_DISABLED: { group: "other", label: "Conjunto desativado", tone: "neutral" },
  CAMPAIGN_DISABLED: { group: "other", label: "Campanha desativada", tone: "neutral" },
};

const textOf = (code: string | null): StateText | null => code ? { code, label: KNOWN[code]?.label ?? `Código ${code}` } : null;

/**
 * Classifica a veiculação a partir do que a Meta devolveu.
 * - O rótulo vem do estado efetivo; sem ele a entidade é "Indisponível" (o estado configurado, se houver, fica no detalhe).
 * - Conta sem condição de veicular, problemas registrados e ausência de entrega entram em `restrictions`, sem trocar o rótulo:
 *   uma campanha pausada em conta com problema financeiro continua "Pausado".
 * - `delivering` é a checagem existente de entrega (programação vigente e anúncio ativo): só gera restrição quando o efetivo é ACTIVE.
 */
export function classifyDelivery(state: LiveDeliveryState | null | undefined, delivering: boolean | null = null): DeliveryState {
  const configured = textOf(state?.configured ?? null);
  const effective = textOf(state?.status ?? null);
  const restrictions: Restriction[] = [];
  if (state?.accountBlocked) restrictions.push({ key: "account", label: "Conta sem veiculação", detail: "A conta de anúncios não está em condição de veicular (pagamento, risco ou desativação)." });
  if (state?.issues) restrictions.push({ key: "issues", label: "Com problemas de entrega", detail: "A Meta registrou problemas de entrega nesta entidade." });
  if (state?.status === "ACTIVE" && delivering === false && !state.accountBlocked) {
    restrictions.push({ key: "no_delivery", label: "Sem entrega no momento", detail: "Ativo, mas sem conjunto ou anúncio em condição de veicular (programação encerrada ou itens pausados)." });
  }
  const createdAt = state?.createdAt ?? null;
  if (!effective) {
    return { group: "unavailable", label: "Indisponível", tone: "neutral", configured, effective: null, restrictions, createdAt,
      detail: `A Meta não devolveu o estado efetivo desta entidade agora.${configured ? ` Configurado: ${configured.label}.` : ""}` };
  }
  const known = KNOWN[effective.code];
  const note = [configured && configured.code !== effective.code ? `Configurado: ${configured.label}` : null, `Efetivo: ${effective.label}`, ...restrictions.map(item => item.label)].filter(Boolean).join(" · ");
  if (!known) return { group: "other", label: "Estado não classificado", tone: "neutral", configured, effective, restrictions, createdAt, detail: `Código da Meta: ${effective.code}. ${note}` };
  return { ...known, configured, effective, restrictions, createdAt, detail: note };
}
