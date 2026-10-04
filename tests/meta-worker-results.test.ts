import { describe,expect,it } from "vitest";
import type { MetaInsight } from "@/modules/meta/client";
import { nativeWorkerResults,workerResultIndicators } from "@/modules/meta/worker-results";

const base: MetaInsight = { account_id: "123",date_start: "2026-10-01",date_stop: "2026-10-03",spend: "100",impressions: "1000" };
describe("native Meta results for queued collections",() => {
  it("preserves precision and native result type",() => {
    expect(nativeWorkerResults({ ...base,results: [{ indicator: "actions:lead",values: [{ value: "123456789012345678.12345678" }] }] })).toEqual({ known: true,values: { "action:lead": "123456789012345678.12345678" } });
  });
  it("calculates cost only from the single native indicator",() => {
    expect(workerResultIndicators({ ...base,actions: [{ action_type: "purchase",value: "999" }],results: [{ indicator: "actions:lead",values: [{ value: "25" }] }] },"100")).toMatchObject({ primary: "25",cost: "4" });
  });
  it("does not replace missing Results with secondary actions",() => {
    expect(workerResultIndicators({ ...base,actions: [{ action_type: "lead",value: "999" }] },"100")).toMatchObject({ known: false,primary: null,cost: null });
  });
  it("keeps different native indicators separate",() => {
    expect(workerResultIndicators({ ...base,results: [{ indicator: "actions:lead",values: [{ value: "25" }] },{ indicator: "actions:purchase",values: [{ value: "2" }] }] },"100")).toMatchObject({ known: true,primary: null,cost: null,values: { "action:lead": "25","action:purchase": "2" } });
  });
  it.each([
    [{ indicator: "actions:lead",values: [{ value: "1" },{ value: "2" }] }],
    [{ indicator: "actions:lead",values: [{ value: "1" }] },{ indicator: "actions:lead",values: [{ value: "2" }] }],
    [{ indicator: "actions:lead",values: [{ value: "-1" }] }],
    [{ indicator: "actions:lead",values: [{ value: "NaN" }] }],
    [{ indicator: "actions:lead",values: [{ value: Number.MAX_SAFE_INTEGER+1 }] }],
    [{ indicator: "https://example.test?token=secret",values: [{ value: "1" }] }],
  ].map(results => ({ results })))("does not confirm ambiguous or malformed Results",({ results }) => {
    expect(nativeWorkerResults({ ...base,results })).toEqual({ known: false,values: {} });
  });
  it("keeps cost unavailable for a confirmed zero result",() => {
    expect(workerResultIndicators({ ...base,results: [] },"100")).toMatchObject({ known: true,primary: "0",cost: null });
  });
  it("uses the existing no-delivery rule even with malformed Results",() => {
    expect(workerResultIndicators({ ...base,spend: "0",impressions: "0",results: [{ values: [] }] },"0")).toMatchObject({ known: true,primary: "0",cost: null });
  });
});
