import { describe, expect, it, vi } from "vitest";
import { BATCH_MAX, planBatch, runBatch, summarizeBatch, type BatchRunner } from "@/modules/campaigns/navigation/batch";
import { buildCsv, csvCell } from "@/modules/campaigns/navigation/export-csv";
import { buildColumns, buildCostIndex, resultFamilies } from "@/modules/campaigns/columns";
import { entityKey } from "@/modules/campaigns/navigation/selection";
import { campaignsData, IDS, LEAD, row, vals } from "./campaign-assistant-fixtures";

const keyOf = (item: Parameters<typeof entityKey>[0]) => entityKey(item);
const active = (id: string, account = IDS.accA) => row("campaign", id, `Camp ${id}`, null, account, vals(10));
const paused = (id: string, account = IDS.accA) => row("campaign", id, `Pausada ${id}`, null, account, vals(10), "PAUSED");

describe("operações em lote: planejamento", () => {
  it("pausar: ativas são compatíveis; pausadas, anúncios e estado desconhecido são incompatíveis com motivo", () => {
    const unknown = row("campaign", "9", "Sem estado", null, IDS.accA, vals(1), null);
    const plan = planBatch("pause", [active("1"), paused("2"), row("ad", "300", "Vídeo", "200", IDS.accA, vals(1)), unknown, row("campaign", "5", "Arquivada", null, IDS.accA, vals(1), "ARCHIVED")], keyOf);
    expect(plan.compatible.map(item => item.row.id)).toEqual(["1"]);
    expect(plan.incompatible.map(item => item.reason)).toEqual(["Já está pausada.", expect.stringMatching(/anúncios ainda não/), expect.stringMatching(/não confirmado/), expect.stringMatching(/não permite/)]);
    expect(plan.accounts).toEqual(["Conta A"]);
  });
  it("retomar: só pausadas; mais de 20 compatíveis marca excesso", () => {
    expect(planBatch("resume", [active("1"), paused("2")], keyOf).compatible.map(item => item.row.id)).toEqual(["2"]);
    const many = Array.from({ length: BATCH_MAX + 1 }, (_, i) => active(String(i + 1)));
    expect(planBatch("pause", many, keyOf).tooMany).toBe(true);
    expect(planBatch("pause", many.slice(0, BATCH_MAX), keyOf).tooMany).toBe(false);
  });
});

describe("operações em lote: execução", () => {
  const items = (rows: ReturnType<typeof active>[]) => planBatch("pause", rows, keyOf).items;
  const ok = (outcome: "verified" | "needs_verification" = "verified") => ({ ok: true as const, outcome, message: outcome, control: null });
  const uid = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; };

  it("todas compatíveis: uma operação por entidade, em sequência, com id de solicitação próprio e estado esperado", async () => {
    const runner = vi.fn<BatchRunner>(async () => ok());
    const outcomes = await runBatch({ clientId: IDS.client, op: "pause", items: items([active("1"), active("2")]), runner, newRequestId: uid() });
    expect(summarizeBatch(outcomes)).toEqual({ verified: 2, uncertain: 0, failed: 0, skipped: 0 });
    expect(runner).toHaveBeenCalledTimes(2);
    const [first, second] = runner.mock.calls.map(call => call[0]);
    expect(first).toMatchObject({ ref: { clientId: IDS.client, accountId: IDS.accA, level: "campaign", entityId: "1" }, op: "pause", expected: { configuredStatus: "ACTIVE", dailyBudgetMinor: null } });
    expect(first!.requestId).not.toBe(second!.requestId);
  });
  it("sucesso parcial e falha parcial aparecem por entidade", async () => {
    const runner = vi.fn<BatchRunner>(async input => input.ref.entityId === "2" ? { ok: false, code: "blocked", message: "bloqueada" } : ok());
    const outcomes = await runBatch({ clientId: IDS.client, op: "pause", items: items([active("1"), active("2"), active("3")]), runner, newRequestId: uid() });
    expect(outcomes.map(item => item.status)).toEqual(["verified", "failed", "verified"]);
  });
  it("resultado desconhecido interrompe só a MESMA conta: nada é reenviado nem enviado a ela", async () => {
    const runner = vi.fn<BatchRunner>(async input => input.ref.entityId === "1" ? ok("needs_verification") : ok());
    const outcomes = await runBatch({ clientId: IDS.client, op: "pause", items: items([active("1"), active("2"), active("3", IDS.accB)]), runner, newRequestId: uid() });
    expect(outcomes.map(item => item.status)).toEqual(["needs_verification", "skipped", "verified"]);
    expect(runner.mock.calls.map(call => call[0].ref.entityId)).toEqual(["1", "3"]);
  });
  it("conta ocupada ou serviço sem resposta também bloqueia o restante da conta; exceção do runner vira falha sem repetir", async () => {
    const busy = vi.fn<BatchRunner>(async () => ({ ok: false, code: "busy", message: "ocupada" }));
    expect((await runBatch({ clientId: IDS.client, op: "pause", items: items([active("1"), active("2")]), runner: busy, newRequestId: uid() })).map(item => item.status)).toEqual(["failed", "skipped"]);
    expect(busy).toHaveBeenCalledTimes(1);
    const boom = vi.fn<BatchRunner>(async () => { throw new Error("rede"); });
    expect((await runBatch({ clientId: IDS.client, op: "pause", items: items([active("1"), active("2")]), runner: boom, newRequestId: uid() })).map(item => item.status)).toEqual(["failed", "skipped"]);
    expect(boom).toHaveBeenCalledTimes(1);
  });
  it("limite por lote: o excedente nunca é enviado", async () => {
    const runner = vi.fn<BatchRunner>(async () => ok());
    const many = Array.from({ length: BATCH_MAX + 2 }, (_, i) => active(String(i + 1)));
    const outcomes = await runBatch({ clientId: IDS.client, op: "pause", items: items(many), runner, newRequestId: uid() });
    expect(runner).toHaveBeenCalledTimes(BATCH_MAX);
    expect(outcomes.filter(item => item.status === "skipped")).toHaveLength(2);
  });
  it("anúncios nunca são enviados ao executor", async () => {
    const runner = vi.fn<BatchRunner>(async () => ok());
    const ad = row("ad", "300", "Vídeo", "200", IDS.accA, vals(1));
    const outcomes = await runBatch({ clientId: IDS.client, op: "pause", items: [{ key: "k", row: ad, compatible: true }], runner, newRequestId: uid() });
    expect(runner).not.toHaveBeenCalled();
    expect(outcomes[0]!.status).toBe("skipped");
  });
});

describe("exportação CSV", () => {
  const data = campaignsData();
  const columns = buildColumns(data.metrics, resultFamilies(data.rows)).filter(column => ["spend", "results", "cost_result", "impressions", `result:${LEAD}`].includes(column.key));
  const index = buildCostIndex(data.rows);
  const ads = data.rows.filter(item => item.level === "ad");

  it("exporta TODAS as linhas recebidas (não só a página), com cabeçalho, conta, moeda e colunas escolhidas", () => {
    const csv = buildCsv({ level: "campaign", rows: data.rows.filter(item => item.level === "campaign"), columns, index, parentNames: new Map() });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(1 + 3);
    expect(lines[0]).toContain("Nome;Conta;Moeda;Estado;Estado configurado;Estado efetivo;Investimento;Resultados");
    expect(lines[1]).toContain("Captação;Conta A;BRL");
  });
  it("valor indisponível sai vazio (nunca zero) e decimais usam vírgula", () => {
    const csv = buildCsv({ level: "campaign", rows: data.rows.filter(item => item.level === "campaign"), columns, index, parentNames: new Map() });
    const remarketing = csv.split("\r\n").find(line => line.startsWith("Remarketing"))!;
    expect(remarketing.split(";").slice(6).every(cell => cell === "")).toBe(true);
    expect(csv).toMatch(/Captação;Conta A;BRL;[^;]*;[^;]*;[^;]*;300;/);
  });
  it("anúncios incluem o conjunto de origem", () => {
    const parentNames = new Map(ads.map(item => [`${item.accountId}|${item.level}|${item.id}`, "Formulário"]));
    const csv = buildCsv({ level: "ad", rows: ads, columns, index, parentNames });
    expect(csv.split("\r\n")[0]).toContain("Nome;Conjunto;Conta");
    expect(csv).toContain("Vídeo;Formulário;Conta A");
  });
  it("proteção contra injeção de fórmulas e aspas/separadores em nomes", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("a;b")).toBe("\"a;b\"");
    expect(csvCell("a\nb")).toBe("\"a\nb\"");
    expect(csvCell(12.5)).toBe("12,5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(csvCell("")).toBe("");
  });
});
