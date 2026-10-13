import "server-only";

import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { normalizeHierarchy } from "@/modules/client-portal/analytics-hierarchy";
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
- Se os fatos trouxerem "contas", cada conta tem o seu objetivo e os seus números. Analise uma conta de cada vez, citando o nome da conta, e nunca some nem compare resultados entre contas. Conta sem investimento no período: diga só isso em poucas palavras, sem comentar resultados nem confirmação de dados.
- Só diga onde o investimento se concentrou comparando o "investimento_nas_campanhas_deste_tipo" de cada tipo de resultado. Sem esses valores, não afirme concentração.
- Use o nome exato de cada métrica dos fatos. "Cliques" e "cliques no link" são métricas diferentes: nunca troque uma pela outra.

Anúncios:
- Quando houver "anuncios_com_menor_custo_por_resultado" e "anuncios_com_maior_custo_por_resultado", cite pelo nome até 3 melhores (menor custo) e até 3 piores (maior custo), cada um com o custo por resultado e o tipo de resultado. Só compare anúncios do mesmo tipo de resultado e cite somente os que estão nessas listas. Se as listas estiverem vazias, não fale de anúncios.

Honestidade:
- Não diga que o desempenho foi "bom" ou "ruim" sem referência nos fatos. Não explique causas que os dados não mostram. Não trate conversas, visitas ou engajamento como vendas.
- Respeite os "limites_da_leitura": se algo não está disponível, não suponha.

Formato: a mensagem já mostra investimento, alcance, impressões, cliques e a lista de resultados com custos. Não repita esses números em bloco: interprete-os (o que mudou e onde o investimento rendeu mais) e dê o próximo passo.
Texto em até 110 palavras (até 170 quando houver mais de uma conta), sem emojis, sem tabelas e sem Markdown (nada de asteriscos ou negrito). Primeiro 2 a 3 frases curtas de interpretação (uma frase por conta, quando houver contas). Se houver anúncios nas listas, depois duas linhas, cada uma começando pelo rótulo:
Melhores anúncios: nomes com o custo por resultado de cada um.
Piores anúncios: nomes com o custo por resultado de cada um.
Termine com uma frase de próximo passo sustentada pelos dados. Não faça saudação nem despedida e não cite o nome do cliente: a mensagem já tem isso.`;

export type WhatsAppSummaryInput = {
  agencyId: string; clientId: string; data: AnalyticsDashboardData; service: Service;
  // Contas separadas: cada uma com os próprios números. Sem isso, o resumo usa `data` (todas as contas somadas).
  accounts?: Array<{ id: string; name: string; data: AnalyticsDashboardData }>;
};

// Resumo curto para o WhatsApp. Só gera com todos os dias do período confirmados e o agregado da Meta confirmado.
export async function generateWhatsAppSummary(input: WhatsAppSummaryInput, deps: GuardedDeps = {}): Promise<GuardedResult> {
  const { data } = input;
  const parts = input.accounts?.length ? input.accounts.map(account => account.data) : [data];
  if (parts.some(part => part.coverage.status !== "complete" || !part.metaAggregate?.confirmed)) {
    return { ok: false, reason: "unavailable", message: "Os números do período ainda não estão confirmados para a análise com IA. Atualize os dados do cliente." };
  }
  const { data: profileRow } = await input.service.from("client_profiles")
    .select(PROFILE_FIELDS.map(item => item.key).join(",")).eq("client_id", input.clientId).maybeSingle();
  const profile: ClientProfile = { ...EMPTY_PROFILE, ...((profileRow ?? {}) as unknown as Partial<ClientProfile>) };
  // Anúncios do período (para citar os melhores e os piores). Sem eles, o resumo segue só com os totais.
  const { data: hierarchy, error: hierarchyError } = await input.service.rpc("service_client_hierarchy", { p_client_id: input.clientId, p_date_from: data.dateFrom, p_date_to: data.dateTo });
  const entities = hierarchyError || !hierarchy ? [] : normalizeHierarchy(hierarchy);
  const profileFacts = profileForPrompt(profile);
  const factsFor = (part: AnalyticsDashboardData, accountId?: string) =>
    formatFactsForPrompt(buildReportFacts(confirmedReportData(part), accountId ? entities.filter(entity => entity.accountId === accountId) : entities), accountId ? null : profileFacts);
  const facts = input.accounts?.length
    ? { ...(profileFacts && Object.keys(profileFacts).length ? { perfil_do_cliente: profileFacts } : {}), contas: input.accounts.map(account => ({ nome_da_conta: account.name, ...factsFor(account.data, account.id) })) }
    : factsFor(data);
  return runGuardedGeneration({
    agencyId: input.agencyId, clientId: input.clientId, userId: null, feature: "whatsapp_summary",
    system: WHATSAPP_SYSTEM_PROMPT, factsLabel: "Fatos confirmados do período (JSON):",
    factsText: JSON.stringify(facts, null, 2),
    sourceRef: `${data.dateFrom}..${data.dateTo}`, maxTokens: 600,
  }, { supabase: input.service, ...deps });
}
