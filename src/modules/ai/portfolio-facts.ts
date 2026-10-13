import { int, money, pct } from "@/modules/reports/format";
import type { PortfolioRow, PortfolioStatus } from "@/modules/operations/portfolio-view";

// Variação de investimento acima disso entra como alerta (só informa, não julga).
const SPEND_SWING_PCT = 30;

const STATUS_ALERT: Record<PortfolioStatus, string | null> = {
  ok: null,
  "no-delivery": "Sem veiculação na última semana do período.",
  "cost-up": "Custo por resultado subiu mais de 20% contra o período anterior.",
  "no-accounts": "Sem conta de anúncios ligada.",
  updating: "Dados do período ainda em atualização; números não confirmados.",
  unavailable: "Dados indisponíveis agora.",
};

function spendChange(row: PortfolioRow) {
  if (row.spend == null || row.previousSpend == null || row.previousSpend === 0) return null;
  return ((row.spend - row.previousSpend) / row.previousSpend) * 100;
}

// Fatos da carteira calculados só pelo código: a IA recebe alertas prontos e números formatados.
export function buildPortfolioFacts(rows: PortfolioRow[], periodLabel: string) {
  const clients = rows.map(row => {
    const change = spendChange(row);
    const alerts = [STATUS_ALERT[row.status]].filter((alert): alert is string => alert != null);
    if (change != null && Math.abs(change) >= SPEND_SWING_PCT) alerts.push(`Investimento variou ${pct(change)} contra o período anterior.`);
    return {
      nome: row.name,
      alertas: alerts,
      investimento: row.spend == null ? null : money(row.spend, row.currency),
      investimento_periodo_anterior: row.previousSpend == null ? null : money(row.previousSpend, row.currency),
      variacao_do_investimento: pct(change),
      resultados_por_tipo: row.results.map(result => ({
        tipo: result.label,
        quantidade: int(result.value),
        // Só existe quando o cliente tem um único tipo de resultado (com vários, o investimento é dividido entre eles).
        custo_por_resultado: result.cost == null ? null : money(result.cost, row.currency),
        custo_por_resultado_periodo_anterior: result.previousCost == null ? null : money(result.previousCost, row.currency),
        variacao_do_custo: result.cost != null && result.previousCost != null && result.previousCost > 0 ? pct(((result.cost - result.previousCost) / result.previousCost) * 100) : null,
      })),
    };
  });
  const withAlerts = clients.filter(client => client.alertas.length > 0);
  return {
    periodo: periodLabel,
    clientes_ativos: int(clients.length),
    clientes_com_alertas: int(withAlerts.length),
    clientes_sem_alertas: int(clients.length - withAlerts.length),
    clientes: clients,
  };
}

export type PortfolioFacts = ReturnType<typeof buildPortfolioFacts>;

export const PORTFOLIO_SYSTEM_PROMPT = `Você escreve o "Resumo do dia" para o responsável pelo tráfego pago, a partir de fatos já calculados de todos os clientes dele.

Objetivo: dizer em segundos quais clientes pedem atenção e por quê, para ele não precisar abrir cliente por cliente.

Regras:
- Português do Brasil, direto e curto. Nunca use a palavra "agência".
- Use SOMENTE números e nomes que estejam nos fatos, escritos exatamente como estão. Não calcule, não arredonde e não invente.
- Cada cliente tem "alertas" prontos. Só cite como problema o que estiver em "alertas". Não diga que um cliente vai bem ou mal por conta própria.
- Resultados são por tipo e cada tipo tem custo próprio; nunca some tipos diferentes e nunca escolha um "resultado principal". Cite custo só quando o fato trouxer.
- Não explique causas que os dados não mostram e não dê dicas genéricas. Se um dado não está disponível, diga isso.

Formato (no máximo 180 palavras, sem emojis, sem Markdown, sem asteriscos):
Primeira linha: quantos clientes ativos, quantos com alertas e o período.
Depois, uma linha por cliente com alertas (no máximo 6, os mais importantes primeiro), no formato "Nome: motivo com os números".
Última linha: "Sem alertas:" com os nomes dos clientes sem alertas (até 8) ou, se forem mais, a quantidade.
Se nenhum cliente tiver alertas, diga isso em uma frase e liste a quantidade de clientes acompanhados.`;
