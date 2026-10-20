import { describe, expect, it } from "vitest";
import { classifyDelivery } from "@/modules/campaigns/delivery-state";
import { liveRawDeliveryStates } from "@/modules/meta/delivery";

const state = (status: string | null, extra: Partial<{ configured: string | null; issues: boolean; accountBlocked: boolean }> = {}) => ({ configured: null, status, issues: false, accountBlocked: false, ...extra });

describe("classifyDelivery", () => {
  it("separa os estados efetivos da Meta em vez de tratar tudo que não é ACTIVE como desativado", () => {
    expect(classifyDelivery(state("ACTIVE"), true)).toMatchObject({ group: "active", label: "Ativo" });
    expect(classifyDelivery(state("PAUSED"))).toMatchObject({ group: "paused", label: "Pausado" });
    expect(classifyDelivery(state("CAMPAIGN_PAUSED"))).toMatchObject({ group: "paused" });
    expect(classifyDelivery(state("ADSET_PAUSED"))).toMatchObject({ group: "paused" });
    expect(classifyDelivery(state("PENDING_REVIEW"))).toMatchObject({ group: "review", label: "Em análise" });
    expect(classifyDelivery(state("IN_PROCESS"))).toMatchObject({ group: "review" });
    expect(classifyDelivery(state("DISAPPROVED"))).toMatchObject({ group: "rejected", label: "Reprovado" });
    expect(classifyDelivery(state("WITH_ISSUES"))).toMatchObject({ group: "rejected" });
    expect(classifyDelivery(state("ARCHIVED"))).toMatchObject({ group: "other", label: "Arquivado" });
  });
  it("não inventa classificação para estado ausente ou desconhecido", () => {
    expect(classifyDelivery(null)).toMatchObject({ group: "unavailable", label: "Indisponível", effective: null });
    expect(classifyDelivery(state(null))).toMatchObject({ group: "unavailable" });
    const unknown = classifyDelivery(state("NOVO_ESTADO_DA_META"));
    expect(unknown).toMatchObject({ group: "other", label: "Estado não classificado", effective: { code: "NOVO_ESTADO_DA_META" } });
    expect(unknown.detail).toContain("NOVO_ESTADO_DA_META");
  });
  it("estado indisponível preserva o estado configurado no detalhe", () => {
    const result = classifyDelivery(state(null, { configured: "PAUSED" }));
    expect(result).toMatchObject({ group: "unavailable", configured: { code: "PAUSED", label: "Pausado" } });
    expect(result.detail).toContain("Configurado: Pausado");
  });
  it("restrições não escondem o estado original: pausada em conta bloqueada continua Pausado", () => {
    const paused = classifyDelivery(state("PAUSED", { configured: "PAUSED", accountBlocked: true }), false);
    expect(paused).toMatchObject({ group: "paused", label: "Pausado" });
    expect(paused.restrictions.map(item => item.key)).toEqual(["account"]);
    const active = classifyDelivery(state("ACTIVE", { configured: "ACTIVE", accountBlocked: true }), true);
    expect(active).toMatchObject({ group: "active", label: "Ativo" });
    expect(active.restrictions.map(item => item.key)).toEqual(["account"]);
  });
  it("registra problemas e falta de entrega como restrições; falta de entrega só vale com efetivo ACTIVE", () => {
    expect(classifyDelivery(state("ACTIVE", { issues: true }), true)).toMatchObject({ group: "active", restrictions: [{ key: "issues" }] });
    expect(classifyDelivery(state("ACTIVE"), false).restrictions.map(item => item.key)).toEqual(["no_delivery"]);
    expect(classifyDelivery(state("ACTIVE"), null).restrictions).toEqual([]);
    expect(classifyDelivery(state("PAUSED"), false).restrictions).toEqual([]);
  });
  it("mostra a divergência entre configurado e efetivo no detalhe", () => {
    const result = classifyDelivery(state("CAMPAIGN_PAUSED", { configured: "ACTIVE" }));
    expect(result).toMatchObject({ group: "paused", configured: { code: "ACTIVE" }, effective: { code: "CAMPAIGN_PAUSED" } });
    expect(result.detail).toContain("Configurado: Ativo");
  });
});

describe("liveRawDeliveryStates", () => {
  it("devolve configurado e efetivo brutos por nível, sem colapsar em ACTIVE/INACTIVE", () => {
    const states = liveRawDeliveryStates(
      [{ id: "1", name: "C", status: "paused", effective_status: "paused" }] as never,
      [{ id: "2", name: "S", campaign_id: "1", status: "ACTIVE", effective_status: "CAMPAIGN_PAUSED", issues_info: [{}] }] as never,
      [{ id: "3", name: "A", adset_id: "2", campaign_id: "1" }] as never, 3);
    expect(states["campaign:1"]).toEqual({ configured: "PAUSED", status: "PAUSED", issues: false, accountBlocked: true });
    expect(states["adset:2"]).toMatchObject({ configured: "ACTIVE", status: "CAMPAIGN_PAUSED", issues: true });
    expect(states["ad:3"]).toMatchObject({ configured: null, status: null });
  });
});
