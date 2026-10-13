import { describe, expect, it } from "vitest";
import { accountSummaries } from "@/modules/client-portal/account-comparison";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";

describe("contas lado a lado", () => {
  it("uma linha por conta selecionada, com o investimento de cada uma", () => {
    const data = getDemoClientAnalytics();
    const accounts = accountSummaries(data);
    expect(accounts.map(account => account.id)).toEqual(["a1", "a2"]);
    expect(accounts.every(account => account.metrics[0][1].startsWith("R$"))).toBe(true);
  });
  it("conta fora da seleção não aparece e conta sem investimento é marcada", () => {
    const data = getDemoClientAnalytics();
    const only = accountSummaries({ ...data, selectedAccountIds: ["a2"], accountTotals: data.accountTotals.map(account => account.id === "a2" ? { ...account, values: { ...account.values, spend: 0 } } : account) });
    expect(only).toHaveLength(1);
    expect(only[0].idle).toBe(true);
  });
});

describe("leitura própria de cada conta", () => {
  it("usa o investimento da leitura da conta quando ela existe", () => {
    const data = getDemoClientAnalytics();
    const accounts = accountSummaries(data, [{ id: "a1", name: "x", data: { ...data, summary: { ...data.summary, spend: 123 } } }]);
    expect(accounts[0].metrics[0][1]).toMatch(/R\$\s123,00/);
    expect(accounts[1].metrics[0][1]).not.toMatch(/123,00/);
  });
});
