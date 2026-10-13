import "server-only";

import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { buildReportFacts } from "@/modules/reports/report-facts";
import { confirmedReportData } from "@/modules/reports/report-presentation";
import { EMPTY_PROFILE, PROFILE_FIELDS, profileForPrompt, type ClientProfile } from "@/modules/clients/profile";
import { runGuardedGeneration, type GuardedDeps, type GuardedResult } from "./guarded-text";
import { formatFactsForPrompt } from "./prompt-facts";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";

type Service = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

// Instruções do resumo curto que vai dentro da mensagem de WhatsApp. Texto fixo e estável (bom para cache).
export const WHATSAPP_SYSTEM_PROMPT = `Você escreve um resumo curto, para ser lido no WhatsApp, do desempenho do tráfego pago de um cliente. O texto vai dentro de uma mensagem que o responsável pelo tráfego envia ao cliente, depois de revisar.

Quem lê: dono de negócio que não conhece marketing digital. Linguagem simples, calorosa e direta, sem jargão. Nunca use a palavra "agência".

Números:
- Use SOMENTE números que estejam nos fatos e escreva-os exatamente como estão, com ponto de milhar e vírgula decimal (ex.: 1.384, R$ 10,88, +43,5%).
- Não calcule, não arredonde, não converta e não invente nenhum número, percentual ou comparação que não esteja nos fatos.
- Ao descrever uma variação, escreva "queda de 16,6%" ou "-16,6%", nunca os dois ao mesmo tempo.

Resultados:
- Todos os tipos de resultado importam e cada um tem custo próprio. Cite cada tipo separadamente, nunca some tipos diferentes e nunca escolha um "resultado principal".
- Compare com o período anterior só quando os fatos trouxerem a variação. Sem comparação disponível, descreva sem comparar.
- Se os fatos trouxerem "perfil_do_cliente", use-o só como contexto do negócio.

Honestidade:
- Não diga que o desempenho foi "bom" ou "ruim" sem referência nos fatos. Não explique causas que os dados não mostram. Não trate conversas, visitas ou engajamento como vendas.
- Respeite os "limites_da_leitura": se algo não está disponível, não suponha.

Formato: no máximo 70 palavras, texto corrido em 2 a 4 frases curtas, sem emojis, sem listas, sem tabelas e sem Markdown (nada de asteriscos ou negrito). Não faça saudação nem despedida e não cite o nome do cliente: a mensagem já tem isso. Termine com uma frase de próximo passo sustentada pelos dados.`;

export type WhatsAppSummaryInput = { agencyId: string; clientId: string; data: AnalyticsDashboardData; service: Service };

// Resumo curto para o WhatsApp. Só gera com todos os dias do período confirmados e o agregado da Meta confirmado.
export async function generateWhatsAppSummary(input: WhatsAppSummaryInput, deps: GuardedDeps = {}): Promise<GuardedResult> {
  const { data } = input;
  if (data.coverage.status !== "complete" || !data.metaAggregate?.confirmed) {
    return { ok: false, reason: "unavailable", message: "Os números do período ainda não estão confirmados para a análise com IA. Atualize os dados do cliente." };
  }
  const { data: profileRow } = await input.service.from("client_profiles")
    .select(PROFILE_FIELDS.map(item => item.key).join(",")).eq("client_id", input.clientId).maybeSingle();
  const profile: ClientProfile = { ...EMPTY_PROFILE, ...((profileRow ?? {}) as unknown as Partial<ClientProfile>) };
  const facts = buildReportFacts(confirmedReportData(data));
  return runGuardedGeneration({
    agencyId: input.agencyId, clientId: input.clientId, userId: null, feature: "whatsapp_summary",
    system: WHATSAPP_SYSTEM_PROMPT, factsLabel: "Fatos confirmados do período (JSON):",
    factsText: JSON.stringify(formatFactsForPrompt(facts, profileForPrompt(profile)), null, 2),
    sourceRef: `${data.dateFrom}..${data.dateTo}`, maxTokens: 600,
  }, { supabase: input.service, ...deps });
}
