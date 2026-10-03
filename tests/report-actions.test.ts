import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),revalidate:vi.fn(),analytics:vi.fn(),refresh:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/modules/client-portal/context",()=>({requireClientDashboardAccess:mocks.access}));
vi.mock("@/modules/client-portal/analytics-live",()=>({getFreshClientAnalytics:mocks.analytics}));
vi.mock("@/modules/meta/server",()=>({refreshMetaDashboardScope:mocks.refresh}));
import { generateDashboardReport, getSavedReportDocument } from "@/modules/client-portal/report-actions";
const clientId="94e033bc-1fe7-4ddb-868d-e2f07b998dae";
const versionId="10000000-0000-4000-8000-000000000001";
const accountId="50000000-0000-4000-8000-000000000001";
const input={clientId,dateFrom:"2026-09-29",dateTo:"2026-10-02",accountIds:[accountId],metricKeys:["spend"],header:{name:"iGrow",details:""},title:"Relatório",orientation:"horizontal"};
const completeAnalytics={metaAggregate:{confirmed:true},coverage:{status:"complete" as const,previousStatus:"complete" as const,latestCollectedAt:"2026-10-03T12:00:00Z",coveredDays:4,previousCoveredDays:4,totalDays:4}};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({canManageReports:true,access:{agencyId:"authorized-agency"},supabase:{rpc:mocks.rpc}});
  mocks.analytics.mockResolvedValue(completeAnalytics);
});
describe("saved dashboard reports",()=>{
  it("saves the chosen format and returns the version to download only with complete coverage",async()=>{
    mocks.rpc.mockResolvedValue({data:versionId,error:null});
    expect(await generateDashboardReport(input)).toMatchObject({success:true,reportVersionId:versionId});
    expect(mocks.analytics).toHaveBeenCalledWith(expect.objectContaining({agencyId:"authorized-agency",clientId,dateFrom:input.dateFrom,dateTo:input.dateTo,accountIds:input.accountIds}));
    expect(mocks.rpc).toHaveBeenCalledWith("create_dashboard_report",expect.objectContaining({p_header:expect.objectContaining({orientation:"horizontal"})}));
  });
  it("blocks report creation when any day is not confirmed",async()=>{
    mocks.analytics.mockResolvedValue({coverage:{...completeAnalytics.coverage,status:"partial",coveredDays:2}});
    expect(await generateDashboardReport(input)).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("blocks a complete daily cache when the exact period was not confirmed",async()=>{
    mocks.analytics.mockResolvedValue({...completeAnalytics,metaAggregate:{confirmed:false}});
    expect(await generateDashboardReport(input)).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not allow a client reader to save or publish a draft",async()=>{
    mocks.access.mockResolvedValue({canManageReports:false,supabase:{rpc:mocks.rpc}});
    expect(await generateDashboardReport(input)).toHaveProperty("error");expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("restores the complete frozen analysis while keeping the chosen overview metrics",async()=>{
    const spend={key:"spend",label:"Valor usado",unit:"currency",precision:2};
    const action={key:"action:test",label:"Ação personalizada",unit:"integer",precision:0};
    mocks.rpc.mockResolvedValue({data:{clientId,title:"Relatório",clientName:"Cliente",workspaceName:"iGrow",dateFrom:"2026-09-29",dateTo:"2026-10-02",currency:"BRL",summary:{spend:50,"action:test":3},metrics:[spend],configuration:{orientation:"horizontal",metric_catalog:[spend,action],header:{name:"iGrow"},analytics:{previousSummary:{spend:25},accountTotals:[{id:"a",name:"Conta",currency:"BRL",values:{spend:50}}],campaigns:[{id:"c",name:"Campanha",accountId:"a",accountName:"Conta",currency:"BRL",values:{spend:50}}]},accounts:[{id:"a",name:"Conta",currency:"BRL"}],account_ids:["a"],coverage:{status:"complete",previousStatus:"complete",latestCollectedAt:"2026-10-03T12:00:00Z",coveredDays:4,previousCoveredDays:4,totalDays:4}}},error:null});
    const result=await getSavedReportDocument({clientId,versionId});
    expect(result).toHaveProperty("document.orientation","horizontal");
    if("error" in result)throw new Error(result.error);
    expect(result.document.metrics.map(m=>m.key)).toEqual(["spend"]);
    expect(result.document.data.metrics.map(m=>m.key)).toContain("action:test");
    expect(result.document.data.previousSummary.spend).toBe(25);
    expect(result.document.data.accountTotals[0].values.spend).toBe(50);
    expect(result.document.data.campaigns[0].name).toBe("Campanha");
  });
  it("refuses an old saved document whose frozen coverage is partial",async()=>{
    mocks.rpc.mockResolvedValue({data:{clientId,title:"Relatório",clientName:"Cliente",workspaceName:"iGrow",dateFrom:"2026-09-29",dateTo:"2026-10-02",currency:"BRL",summary:{spend:50},metrics:[],configuration:{coverage:{status:"partial",previousStatus:"complete",coveredDays:2,previousCoveredDays:4,totalDays:4}}},error:null});
    expect(await getSavedReportDocument({clientId,versionId})).toHaveProperty("error");
  });
});
