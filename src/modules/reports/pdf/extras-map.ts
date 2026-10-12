import type { AudienceRow, ClientAccountBilling, ClientAudienceBreakdowns } from "@/modules/meta/server";
import { money } from "../format";
import type { AudienceGroup, BalanceRow } from "./types";

const compactFormat = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
// O ICU separa o número de "mil" com espaço sem quebra; um espaço comum evita falta de glifo no PDF.
const compact = { format: (value: number) => compactFormat.format(value).replaceAll(" ", " ") };
const MAX_SLICES = 7;

const GROUPS: Array<{ key: "platforms" | "gender" | "age" | "region"; title: string }> = [
  { key: "platforms", title: "Plataformas" }, { key: "gender", title: "Gênero" },
  { key: "age", title: "Idade" }, { key: "region", title: "Região" },
];

// Público do período (alcance), igual aos gráficos de rosquinha do painel: fatias grandes e "Outros".
export function audienceForPdf(data: ClientAudienceBreakdowns): { indicator: string; groups: AudienceGroup[] } | undefined {
  const groups: AudienceGroup[] = [];
  for (const { key, title } of GROUPS) {
    const rows: AudienceRow[] = data[key] ?? [];
    const sorted = rows.map(row => ({ label: row.label, value: row.reach })).filter(item => Number.isFinite(item.value) && item.value > 0).sort((a, b) => b.value - a.value);
    if (sorted.length === 0) continue;
    const grouped = sorted.length > MAX_SLICES
      ? [...sorted.slice(0, MAX_SLICES - 1), { label: "Outros", value: sorted.slice(MAX_SLICES - 1).reduce((sum, item) => sum + item.value, 0) }]
      : sorted;
    groups.push({
      title, total: compact.format(grouped.reduce((sum, item) => sum + item.value, 0)),
      items: grouped.map(item => ({ label: item.label, value: item.value, display: compact.format(item.value) })),
    });
  }
  return groups.length > 0 ? { indicator: "Alcance", groups } : undefined;
}

// Situação financeira de cada conta. Valor que a Meta não informa não aparece como zero.
export function balancesForPdf(accounts: ClientAccountBilling[]): BalanceRow[] | undefined {
  const rows = accounts.map<BalanceRow>(account => {
    const cells: BalanceRow["cells"] = [];
    if (account.prepaid) cells.push({ label: "Saldo pré-pago", value: account.availableBalance == null ? "Indisponível" : money(account.availableBalance, account.currency) });
    else cells.push({ label: "A pagar", value: account.balanceDue == null ? "Indisponível" : money(account.balanceDue, account.currency) });
    if (account.spendCap == null || account.spendCap <= 0) {
      cells.push({ label: "Limite de gastos", value: "Sem limite", sub: account.amountSpent == null ? undefined : `${money(account.amountSpent, account.currency)} gastos desde a criação` });
    } else {
      const left = account.amountSpent == null ? null : Math.max(0, account.spendCap - account.amountSpent);
      cells.push({ label: "Limite de gastos", value: left == null ? money(account.spendCap, account.currency) : `${money(left, account.currency)} restantes`, sub: `de ${money(account.spendCap, account.currency)}` });
    }
    return { name: account.name, status: [account.statusLabel, account.prepaid ? "Pré-pago" : "Pós-pago", account.fundingLabel].filter(Boolean).join(" · "), cells };
  });
  return rows.length > 0 ? rows : undefined;
}
