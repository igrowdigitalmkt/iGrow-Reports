import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),revalidate:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/modules/client-portal/context",()=>({requireClientDashboardAccess:mocks.access}));
import { generateDashboardReport, getSavedReportDocument } from "@/modules/client-portal/report-actions";
const clientId="94e033bc-1fe7-4ddb-868d-e2f07b998dae";
const versionId="10000000-0000-4000-8000-000000000001";
const input={clientId,dateFrom:"2026-09-29",dateTo:"2026-10-02",accountIds:["50000000-0000-4000-8000-000000000001"],metricKeys:["spend"],header:{name:"iGrow",details:""},title:"Relatório",orientation:"horizontal"};
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({canManageReports:true,supabase:{rpc:mocks.rpc}});});
describe("saved dashboard reports",()=>{
  it("saves the chosen format and returns the version to download",async()=>{
    mocks.rpc.mockResolvedValue({data:versionId,error:null});
    expect(await generateDashboardReport(input)).toMatchObject({success:true,reportVersionId:versionId});
    expect(mocks.rpc).toHaveBeenCalledWith("create_dashboard_report",expect.objectContaining({p_header:expect.objectContaining({orientation:"horizontal"})}));
  });
  it("does not allow a client reader to save or publish a draft",async()=>{
    mocks.access.mockResolvedValue({canManageReports:false,supabase:{rpc:mocks.rpc}});
    expect(await generateDashboardReport(input)).toHaveProperty("error");expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("restores the complete frozen analysis while keeping the chosen overview metrics",async()=>{
    const spend={key:"spend",label:"Valor usado",unit:"currency",precision:2};
    const action={key:"action:test",label:"Ação personalizada",unit:"integer",precision:0};
    mocks.rpc.mockResolvedValue({data:{clientId,title:"Relatório",clientName:"Cliente",workspaceName:"iGrow",dateFrom:"2026-09-29",dateTo:"2026-10-02",currency:"BRL",summary:{spend:50,"action:test":3},metrics:[spend],configuration:{orientation:"horizontal",metric_catalog:[spend,action],header:{name:"iGrow"},analytics:{previousSummary:{spend:25},accountTotals:[{id:"a",name:"Conta",currency:"BRL",values:{spend:50}}],campaigns:[{id:"c",name:"Campanha",accountId:"a",accountName:"Conta",currency:"BRL",values:{spend:50}}]},accounts:[{id:"a",name:"Conta",currency:"BRL"}],account_ids:["a"]}},error:null});
    const result=await getSavedReportDocument({clientId,versionId});
    expect(result).toHaveProperty("document.orientation","horizontal");
    if("error" in result)throw new Error(result.error);
    expect(result.document.metrics.map(m=>m.key)).toEqual(["spend"]);
    expect(result.document.data.metrics.map(m=>m.key)).toContain("action:test");
    expect(result.document.data.previousSummary.spend).toBe(25);
    expect(result.document.data.accountTotals[0].values.spend).toBe(50);
    expect(result.document.data.campaigns[0].name).toBe("Campanha");
  });
});
