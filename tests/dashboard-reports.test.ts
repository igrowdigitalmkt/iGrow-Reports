import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { compactEntitySelection, leafKeys, type AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";
vi.mock("@/modules/client-portal/report-actions", () => ({ getSavedReportDocument: vi.fn() }));
import { buildDashboardPdf } from "@/modules/reports/pdf-download";

const entity = (id: string, level: AnalyticsEntity["level"], parentId: string | null): AnalyticsEntity => ({
  key: `${level}:${id}`, id, level, parentId, campaignId: level === "campaign" ? null : "1",
  accountId: "account", accountName: "Conta", name: `Entidade ${id}`, currency: "BRL", values: {},
});
const entities = [entity("1", "campaign", null), entity("2", "adset", "1"), entity("3", "ad", "2"),
  entity("4", "ad", "2"), entity("5", "campaign", null)];
describe("seleção hierárquica", () => {
  it("todas as folhas compactam em pais sem duplicar métricas", () => {
    expect(leafKeys(entities[0], entities)).toEqual(["ad:3", "ad:4"]);
    expect(compactEntitySelection(entities, ["ad:3", "ad:4", "campaign:5"])).toEqual(["campaign:1", "campaign:5"]);
  });
  it("um anúncio e uma campanha inteira permanecem disjuntos", () => {
    expect(compactEntitySelection(entities, ["ad:3", "campaign:5"])).toEqual(["ad:3", "campaign:5"]);
    expect(compactEntitySelection(entities, [])).toEqual([]);
  });
});

describe("PDF do dashboard", () => {
  it("gera arquivo PDF paginado com métricas, gráficos e seleção extensa", () => {
    const metrics = ["spend", "reach", "impressions", "cpm", "primary_results", "cost_per_result", "link_clicks", "ctr_link", "cpc_link", "frequency", "clicks", "inline_post_engagement"].map((key, i) => ({
      key, label: ["Investimento", "Alcance", "Impressões", "CPM", "Resultados", "Custo por resultado", "Cliques no link", "CTR", "CPC", "Frequência", "Todos os cliques", "Engajamentos"][i],
      unit: ["spend", "cpm", "cost_per_result", "cpc_link"].includes(key) ? "currency" as const : "integer" as const,
      precision: 2, desirable: "up" as const,
    }));
    const data = normalizeClientAnalytics({ dateFrom: "2026-09-01", dateTo: "2026-09-30", currency: "BRL", accounts: [{id:"a",name:"Conta principal",timezoneName:"America/Sao_Paulo",currency:"BRL"}], selectedAccountIds:["a"],
      accountTotals:[{id:"a",name:"Conta principal",currency:"BRL",values:{spend:12345.67}}], campaigns:[{id:"c",name:"Campanha destaque",accountId:"a",accountName:"Conta principal",currency:"BRL",values:{spend:12345.67}}], summary: {spend:12345.67,impressions:987654,primary_results:123,reach:null,link_clicks:345,cpm:12.5,cost_per_result:100.37,"action:custom_test":42}, metrics:[...metrics,{key:"action:custom_test",label:"Cadastros especiais",unit:"integer",precision:0,desirable:"up"}],
      daily:Array.from({length:30},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,"0")}`,values:{spend:Math.sin(i)*100+400,primary_results:i%7}})),
      previousDaily:Array.from({length:30},(_,i)=>({date:`2026-08-${String(i+1).padStart(2,"0")}`,values:{spend:200+i,primary_results:i%4}})),
      coverage:{status:"complete",previousStatus:"complete",coveredDays:30,totalDays:30,latestCollectedAt:"2026-10-01T10:00:00Z"} });
    const doc = buildDashboardPdf({ title:"Relatório de performance",clientName:"Cliente demonstrativo",workspaceName:"Gestor de tráfego independente",headerDetails:"Contato: contato@example.test | www.example.test",data,metrics,
      entityLabels:["Todas as campanhas",...Array.from({length:60},(_,i)=>`Anúncio ${i+1}: campanha de demonstração com título extenso para verificar a paginação`)], accountLabels:["Conta principal"],comparison:true,chartType:"bar" });
    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    expect(doc.output()).toContain("Cadastros especiais");
    expect(doc.output()).toContain("Investimento por conta");
    expect(doc.output()).toContain("O que merece aten");
    expect(doc.output()).toContain("Dados di");
    expect(doc.output()).not.toContain("Comparação: período anterior | Gráfico: linhas");
    const pdf = Buffer.from(doc.output("arraybuffer"));
    expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
    const horizontal = buildDashboardPdf({ title:"Relatório de performance",clientName:"Colégio Crescer",workspaceName:"iGrow Digital",headerDetails:"",data,metrics,
      entityRows: entities.map(entity => ({...entity, values:{spend:123.45,reach:1000,impressions:1500}})), campaignMetrics:metrics.slice(0,4),
      entityLabels:["Todas as campanhas"], accountLabels:["Conta principal"],comparison:true,chartType:"bar",orientation:"horizontal" });
    expect(horizontal.internal.pageSize.getWidth() / horizontal.internal.pageSize.getHeight()).toBeCloseTo(16/9, 5);
    expect(horizontal.getNumberOfPages()).toBeGreaterThanOrEqual(6);
    expect(horizontal.output()).toContain("Obrigado.");
    expect(horizontal.output()).not.toContain("Apresentação encerrada");
    if (process.env.IGROW_PDF_QA_DIR) {
      writeFileSync(`${process.env.IGROW_PDF_QA_DIR}/vertical.pdf`,pdf);
      writeFileSync(`${process.env.IGROW_PDF_QA_DIR}/horizontal.pdf`,Buffer.from(horizontal.output("arraybuffer")));
    }
  });
});
