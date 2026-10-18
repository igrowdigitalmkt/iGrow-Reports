import { describe, expect, it } from "vitest";
import { ACTIONS } from "@/modules/agent-executor/policy";
import { aiChangeRequiresHumanApproval, approvalFingerprint } from "@/modules/agent-executor/financial-approval";

const job = {
  id: "30000000-0000-4000-8000-000000000003",
  agency_id: "10000000-0000-4000-8000-000000000001",
  client_id: "20000000-0000-4000-8000-000000000002",
  ad_account_id: "50000000-0000-4000-8000-000000000005",
  action_type: "set_campaign_daily_budget",
  meta_entity_id: "123", daily_budget_minor: 12500,
  rationale: "Campanha exige correcao de verba, mediante aprovacao.",
};

describe("Invariantes de aprovacao financeira por IA", () => {
  it.each(ACTIONS)("acao Meta %s exige aprovacao humana", (action) => {
    expect(aiChangeRequiresHumanApproval(action)).toBe(true);
  });
  it("criacoes e operacoes futuras/desconhecidas falham fechadas", () => {
    for (const action of ["create_campaign", "publish_ad", "change_bid", "unknown_future_action"])
      expect(aiChangeRequiresHumanApproval(action)).toBe(true);
  });
  it("fingerprint vincula exata conta, alvo, verba e justificativa", () => {
    const digest = approvalFingerprint(job);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(approvalFingerprint({ ...job, daily_budget_minor: 12501 })).not.toBe(digest);
    expect(approvalFingerprint({ ...job, agency_id: "99999999-0000-4000-8000-000000000009" })).not.toBe(digest);
    expect(approvalFingerprint({ ...job, rationale: job.rationale + "!" })).not.toBe(digest);
  });
});
