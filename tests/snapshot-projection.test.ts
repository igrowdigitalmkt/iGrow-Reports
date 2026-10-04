import { describe,expect,it } from "vitest";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";
import { projectConfirmedSnapshot } from "@/modules/integrations/snapshot-projection";

const identity: CollectionIdentity = { clientId: "c",connectionId: "i",provider: "meta",externalAccountId: "act_1",dateFrom: "2026-10-01",dateTo: "2026-10-03",level: "campaign",apiVersion: "v24.0",contractVersion: 1 };
const now = Date.parse("2026-10-04T12:00:00Z");
const metric = { provider: "meta",nativeKey: "spend",clientId: "c",connectionId: "i",externalAccountId: "act_1",externalEntityId: "123",level: "campaign",dateFrom: identity.dateFrom,dateTo: identity.dateTo,timezone: "America/Sao_Paulo",currency: "BRL",value: "123456789012345678.12345678",state: "available",mappingVersion: 1,unit: "currency",aggregationRule: "sum" };
const snapshot = { snapshotId: "s",collectedAt: "2026-10-04T11:30:00Z",metrics: [metric] };

describe("confirmed snapshot projection",() => {
  const metadata = { name: "Campanha A",parentId: "act_1",campaignId: "123",adsetId: null };
  const v3Metric = { ...metric,mappingVersion: 3,entity: metadata };
  it("requires hierarchy in Meta contract 3",() => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [{ ...metric,mappingVersion: 3 }] },{ ...identity,contractVersion: 3 },now)).toThrow("Hierarquia");
  });
  it.each([
    { ...metadata,parentId: "act_other" },{ ...metadata,campaignId: "456" },{ ...metadata,adsetId: "123" },
  ])("rejects contradictory campaign parents",invalid => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [{ ...v3Metric,entity: invalid }] },{ ...identity,contractVersion: 3 },now)).toThrow("Hierarquia");
  });
  it("does not merge divergent names for the same entity",() => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [v3Metric,{ ...v3Metric,nativeKey: "revenue",entity: { ...metadata,name: "Other" } }] },{ ...identity,contractVersion: 3 },now)).toThrow("divergentes");
  });
  it("keeps entity scope and decimal precision",() => {
    expect(projectConfirmedSnapshot(snapshot,identity,now)).toMatchObject({ status: "ready",ageMs: 1_800_000,entities: [{ id: "123",currency: "BRL",values: { spend: metric.value },units: { spend: "currency" },aggregationRules: { spend: "sum" } }] });
  });
  it("distinguishes missing snapshots from completed empty responses",() => {
    expect(projectConfirmedSnapshot(null,identity,now).status).toBe("empty");
    expect(projectConfirmedSnapshot({ ...snapshot,metrics: [] },identity,now)).toMatchObject({ status: "ready",entities: [] });
  });
  it("retains stale confirmed values",() => {
    expect(projectConfirmedSnapshot(snapshot,identity,now+1_800_000)).toMatchObject({ status: "stale",entities: [{ values: { spend: metric.value } }] });
  });
  it.each(["clientId","connectionId","provider","externalAccountId","level","dateFrom","dateTo"])("rejects mismatched %s",key => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [{ ...metric,[key]: "other" }] },identity,now)).toThrow("escopo");
  });
  it("rejects another normalization version",() => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [{ ...metric,mappingVersion: 2 }] },identity,now)).toThrow("escopo");
  });
  it.each([
    { value: "0",state: "available" },{ value: "1",state: "zero" },
    { value: "NaN",state: "available" },{ value: "-1",state: "available" },
    { value: null,state: "available" },{ value: "1",state: "unavailable" },
  ])("rejects inconsistent metric states",invalid => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [{ ...metric,...invalid }] },identity,now)).toThrow();
  });
  it("does not turn unavailable metrics into zeros",() => {
    expect(projectConfirmedSnapshot({ ...snapshot,metrics: [{ ...metric,value: null,state: "unavailable" }] },identity,now).entities[0]).toMatchObject({ values: { spend: null },states: { spend: "unavailable" } });
  });
  it("rejects duplicates and incompatible metadata instead of aggregating",() => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [metric,metric] },identity,now)).toThrow("duplicada");
    expect(() => projectConfirmedSnapshot({ ...snapshot,metrics: [metric,{ ...metric,nativeKey: "revenue",currency: "USD" }] },identity,now)).toThrow("Metadados");
  });
  it("rejects future timestamps",() => {
    expect(() => projectConfirmedSnapshot({ ...snapshot,collectedAt: "2026-10-04T13:00:00Z" },identity,now)).toThrow("Horário");
  });
});
