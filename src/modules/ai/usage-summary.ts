/** Agrupa as linhas de ai_usage do mês. Reserva e consumo desconhecido NUNCA entram no consumo liquidado. */
export function summarizeAiUsage(rows: { status: string; cost_usd: number | string | null; needs_reconciliation?: boolean | null }[]) {
  let settled = 0, reserved = 0, unknown = 0, reconcile = 0;
  for (const row of rows) {
    const cost = Number(row.cost_usd ?? 0);
    if (row.status === "reserved") reserved += cost;
    else if (row.status === "unknown_consumption") unknown += cost;
    else settled += cost;
    if (row.needs_reconciliation) reconcile += 1;
  }
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return { settledUsd: round(settled), reservedUsd: round(reserved), unknownUsd: round(unknown), reconcileCount: reconcile };
}

/** Orçamento efetivo (o menor entre o configurado e o do plano) e o que ainda pode ser reservado. O total inclui reservas e desconhecido. */
export function aiAvailability(configuredUsd: number, planUsd: number | null, committedUsd: number) {
  const effective = Math.min(configuredUsd, planUsd ?? Infinity);
  return { effectiveBudgetUsd: effective, availableUsd: Math.max(0, Math.round((effective - committedUsd) * 1e6) / 1e6) };
}
