import { resultBreakdown } from "@/modules/client-portal/analytics-results";
import { jsPDF } from "jspdf";
import { formatAnalyticsValue } from "@/modules/client-portal/analytics-charts";
import type { AnalyticsDashboardData, AnalyticsMetric } from "@/modules/client-portal/analytics-types";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import { getSavedReportDocument } from "@/modules/client-portal/report-actions";
import { buildPresentationPdf } from "./pdf-presentation";
import { reportDate, reportUpdatedAt, resultDescription, estimatedMetric } from "./report-presentation";

export type DashboardPdfInput = {
  title: string; clientName: string; workspaceName: string; headerDetails: string;
  data: AnalyticsDashboardData; metrics: AnalyticsMetric[]; entityLabels: string[]; accountLabels: string[];
  comparison: boolean; chartType: "line" | "bar";
  entityRows?: AnalyticsEntity[]; campaignMetrics?: AnalyticsMetric[];
  orientation?: "vertical" | "horizontal";
  analysisNote?: string;
};

export function buildDashboardPdf(input: DashboardPdfInput) {
  if (input.orientation === "horizontal") return buildPresentationPdf(input);
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const C = { ink:"#142137", muted:"#65748b", blue:"#2563eb", paper:"#f4f7fc", border:"#dce4f0" };
  let y = 20;
  const text = (value: string, size = 10, color = C.ink, bold = false, x = 18, width = 174) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color);
    const lines: string[] = doc.splitTextToSize(value.replace(/[\u2013\u2014]/g,"-"),width);
    const height = Math.max(1,lines.length) * size * .48;
    ensure(height + 2); doc.setFont("helvetica",bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color); doc.text(lines,x,y,{lineHeightFactor:1.35}); y += height + 3;
  };
  const newPage = () => {
    doc.addPage(); y=22;
    doc.setFillColor(C.blue); doc.rect(0,0,210,3,"F");
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(C.muted);
    doc.text(`${input.workspaceName} | ${input.clientName}`,18,13); y=25;
  };
  const ensure = (height: number) => { if(y+height>276) newPage(); };
  const section = (title: string, subtitle?: string, reserve = 70) => {
    ensure(reserve); y+=10; text(title,15,C.ink,true);
    if(subtitle) text(subtitle,9,C.muted);
    y+=4;
  };
  const metricValue = (key: string, value: number | null | undefined, currency = input.data.currency) => {
    const metric = input.data.metrics.find(m=>m.key===key) ?? input.metrics.find(m=>m.key===key);
    return metric ? formatAnalyticsValue(value,metric,currency) : value==null ? "Indisponível" : value.toLocaleString("pt-BR");
  };
  const table = (headers: string[], rows: string[][], widths?: number[]) => {
    const w = widths ?? headers.map(()=>174/headers.length);
    const head = () => {
      doc.setFont("helvetica","bold"); doc.setFontSize(8);
      const labels = headers.map((label,i)=>doc.splitTextToSize(label,w[i]-6) as string[]);
      const h=Math.max(...labels.map(l=>l.length))*4+7;
      ensure(h+12); doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setFillColor(C.paper); doc.rect(18,y,174,h,"F"); doc.setTextColor(C.muted);
      let x=18; labels.forEach((label,i)=>{doc.text(label,x+3,y+5,{lineHeightFactor:1.35});x+=w[i];}); y+=h;
    };
    head();
    rows.forEach((row,index)=>{
      doc.setFont("helvetica","normal"); doc.setFontSize(8);
      const cells = row.map((cell,i)=>doc.splitTextToSize(cell.replace(/[\u2013\u2014]/g,"-"),w[i]-6) as string[]);
      const h=Math.max(...cells.map(c=>c.length))*4+8;
      if(y+h>276){newPage();head();}
      doc.setFont("helvetica","normal"); doc.setFontSize(8);
      if(index%2===0){doc.setFillColor("#fafbfe");doc.rect(18,y,174,h,"F");}
      doc.setTextColor(C.ink);let x=18;cells.forEach((cell,i)=>{doc.text(cell,x+3,y+5,{lineHeightFactor:1.35});x+=w[i];});
      doc.setDrawColor(C.border);doc.line(18,y+h,192,y+h);y+=h;
    }); y+=7;
  };
  doc.setFillColor(C.blue);doc.rect(0,0,210,3,"F");
  text(input.workspaceName,14,C.blue,true); y+=3;
  text(input.title,23,C.ink,true);text(input.clientName,15,C.ink,true);
  text(`${reportDate(input.data.dateFrom)} a ${reportDate(input.data.dateTo)} | Meta Ads`,10,C.muted);
  text(`Cobertura: ${input.data.coverage.coveredDays}/${input.data.coverage.totalDays} dias`,9,C.muted);
  text(`Contas: ${input.accountLabels.join("; ")}`,9,C.muted);
  text(`Última atualização: ${reportUpdatedAt(input.data)} (horário de Brasília)`,9,C.muted);
  const zones=[...new Set(input.data.accounts.filter(a=>input.data.selectedAccountIds.includes(a.id)).map(a=>a.timezoneName))];
  if(zones.length) text(`Fusos: ${zones.join("; ")}`,9,C.muted);
  if(input.headerDetails) {y+=4;text(input.headerDetails,9,C.muted);}
  section("Visão geral dos resultados");
  const resultRows = resultBreakdown(input.data.summary);
  if(resultRows.length) table(["Tipo de resultado", "Quantidade"],resultRows.map(row=>[row.label,row.value.toLocaleString("pt-BR")]),[132,42]);
  for(let index=0;index<input.metrics.length;index+=3){
    doc.setFont("helvetica","normal");doc.setFontSize(7);
    const descriptionLines = doc.splitTextToSize(resultDescription(input.data),48);
    const hasResults = input.metrics.slice(index,index+3).some(metric=>["primary_results","cost_per_result"].includes(metric.key));
    const rowHeight = hasResults ? Math.max(52, descriptionLines.length * 3.2 + 46) : 52;
    ensure(rowHeight+5);
    input.metrics.slice(index,index+3).forEach((metric,column)=>{
      const x=18+column*59;
      doc.setFillColor(C.paper);doc.setDrawColor(C.border);doc.roundedRect(x,y,56,rowHeight,2,2,"FD");
      doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(C.muted);doc.text(doc.splitTextToSize(metric.label,48).slice(0,2),x+4,y+6);
      const value=formatAnalyticsValue(input.data.summary[metric.key],metric,input.data.currency);
      doc.setFont("helvetica","bold");doc.setFontSize(15);doc.setFontSize(Math.min(15,15*48/Math.max(48,doc.getTextWidth(value))));doc.setTextColor(C.ink);doc.text(value,x+4,y+20);
      doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(C.muted);
      if(["primary_results","cost_per_result"].includes(metric.key)) doc.text(descriptionLines,x+4,y+26);
      else if(estimatedMetric(input.data,metric.key)) doc.text("Estimado entre contas",x+4,y+27);
      const current=input.data.summary[metric.key],previous=input.data.previousSummary[metric.key];
      const change=input.comparison ? input.data.coverage.previousStatus!=="complete" ? "Comparação sem cobertura completa" : current==null || previous==null ? "Comparação indisponível" : previous===0 ? "Anterior igual a zero" : `${((current-previous)/Math.abs(previous)*100).toLocaleString("pt-BR",{maximumFractionDigits:1})}% vs. anterior` : "";
      doc.text(doc.splitTextToSize(change,48).slice(0,2),x+4,y+rowHeight-16);
      const values=input.data.daily.map(day=>day.values[metric.key]); const max=Math.max(1,...values.map(value=>value??0));
      doc.setDrawColor(C.blue);doc.setLineWidth(.35);values.forEach((amount,i)=>{
        if(amount==null || values[i-1]==null)return;
        doc.line(x+4+(i-1)*48/Math.max(1,values.length-1),y+rowHeight-3-(values[i-1]??0)/max*6,x+4+i*48/Math.max(1,values.length-1),y+rowHeight-3-amount/max*6);
      });
    });y+=rowHeight+5;
  }
  if(input.data.daily.length) {
  section("Evolução no tempo","Valores diários do investimento e dos resultados.",105);
  for(const key of ["spend","primary_results"]){
    const metric=input.data.metrics.find(m=>m.key===key);if(!metric)continue;
    ensure(75);text(metric.label,11,C.ink,true);
    const top=y,left=43,height=42,width=146;
    const current=input.data.daily.map(d=>d.values[key]),previous=input.data.previousDaily.map(d=>d.values[key]);
    const max=Math.max(1,...current.map(v=>v??0),...(input.comparison?previous.map(v=>v??0):[]));
    for(let tick=0;tick<=4;tick++){
      const py=top+height-tick/4*height;doc.setDrawColor(C.border);doc.setLineWidth(.2);doc.line(left,py,left+width,py);
      doc.setFontSize(7);doc.setTextColor(C.muted);doc.text(metricValue(key,max*tick/4),left-3,py+1,{align:"right"});
    }
    const plot=(values:Array<number|null>,color:string,bars:boolean)=>{
      doc.setDrawColor(color);doc.setFillColor(color);doc.setLineWidth(.5);
      values.forEach((value,i)=>{if(value==null)return;const px=left+i*width/Math.max(1,values.length-1),py=top+height-value/max*height;
        if(bars){const bw=width/Math.max(1,values.length);doc.rect(left+i*bw,py,Math.max(.2,bw*.7),value/max*height,"F");}
        else if(i>0&&values[i-1]!=null)doc.line(left+(i-1)*width/Math.max(1,values.length-1),top+height-(values[i-1]??0)/max*height,px,py);
        else doc.circle(px,py,.5,"F");
      });
    };
    if(input.comparison)plot(previous,"#a5b4fc",false);plot(current,C.blue,input.chartType==="bar");
    y=top+height+5;doc.setFontSize(8);doc.setTextColor(C.muted);doc.text(reportDate(input.data.dateFrom),left,y);doc.text(reportDate(input.data.dateTo),left+width,y,{align:"right"});y+=7;
    if(input.comparison)text("Azul: período atual. Lilás: período anterior.",8,C.muted);y+=5;
  }
  }
  if(input.data.campaigns.length) {
  section("O que merece atenção","Observações descritivas calculadas sobre a seleção desta análise.");
  const campaigns=[...input.data.campaigns].sort((a,b)=>(b.values.spend??0)-(a.values.spend??0));const spend=input.data.summary.spend??0;
  text("Distribuição dos resultados",11,C.ink,true);text(`${resultDescription(input.data)}. Custo por resultado: ${metricValue("cost_per_result",input.data.summary.cost_per_result)}.`,10,C.muted);y+=4;
  text("Concentração do investimento",11,C.ink,true);text(campaigns[0]&&spend?`${campaigns[0].name} concentrou ${((campaigns[0].values.spend??0)/spend*100).toLocaleString("pt-BR",{maximumFractionDigits:1})}% do investimento do período.`:"Sem investimento registrado para a seleção.",10,C.muted);y+=4;
  text("Resposta aos anúncios",11,C.ink,true);text(`${metricValue("link_clicks",input.data.summary.link_clicks)} cliques no link em ${metricValue("impressions",input.data.summary.impressions)} impressões.`,10,C.muted);
  }
  const spend=input.data.summary.spend??0;
  const accounts=input.data.accountTotals.filter(a=>input.data.selectedAccountIds.includes(a.id));
  if(accounts.length&&input.entityLabels.includes("Todas as campanhas")){
    section("Investimento por conta","Distribuição do valor usado entre as contas incluídas na análise.");
    table(["Conta de anúncios","Valor usado","Participação"],accounts.map(a=>[a.name,metricValue("spend",a.values.spend,a.currency),spend?`${((a.values.spend??0)/spend*100).toLocaleString("pt-BR",{maximumFractionDigits:1})}%`:"0%"]),[92,44,38]);
  }
  const actions=input.data.metrics.filter(m=>m.key.startsWith("action:")&&input.data.summary[m.key]!=null);
  if(actions.length){section("Resultados em detalhe","Tipos de ação podem se sobrepor e não são somados como uma conversão única.");
    table(["Ação da plataforma","Resultado"],actions.map(m=>[m.label,formatAnalyticsValue(input.data.summary[m.key],m,input.data.currency)]),[132,42]);}
  section("Seleção incluída na análise","Campanhas, conjuntos e anúncios incluídos nos resultados. Linhas de diferentes níveis não devem ser somadas.");
  const rows=input.entityRows??[];
  const columns=[...new Map([...input.metrics.filter(m=>["spend","reach","impressions","cpm"].includes(m.key)),...(input.campaignMetrics??[])].map(m=>[m.key,m])).values()];
  if(rows.length)for(let offset=0;offset<columns.length;offset+=3){
    const group=columns.slice(offset,offset+3);if(offset){ensure(30);y+=6;}
    table(["Campanha / conjunto / anúncio",...group.map(m=>m.label)],rows.map(e=>[`${e.name}\n${e.level==="campaign"?"Campanha":e.level==="adset"?"Conjunto de anúncios":"Anúncio"} | ${e.accountName}`, ...group.map(m=>formatAnalyticsValue(e.values[m.key],m,e.currency))]),[66,...group.map(()=>108/group.length)]);
  }else input.entityLabels.forEach(label=>text(label,9,C.muted));
  if(input.data.daily.length){section("Dados diários da análise","Datas sem informação confirmada permanecem indisponíveis.");
    const keys=["spend","impressions","link_clicks","primary_results"].filter(key=>input.data.metrics.some(m=>m.key===key));
    table(["Data",...keys.map(key=>input.data.metrics.find(m=>m.key===key)!.label)],input.data.daily.map(day=>[reportDate(day.date),...keys.map(key=>metricValue(key,day.values[key]))]),[30,...keys.map(()=>144/keys.length)]);
  }
  if (input.analysisNote?.trim()) { section("Comentários e próximos passos"); doc.setFont("helvetica", "normal"); doc.setFontSize(10); const lines: string[] = doc.splitTextToSize(input.analysisNote.trim(), 174); for (const line of lines) text(line || " ", 10); }
  section("Informações sobre os dados");
  text("Dados fornecidos pela Meta Ads. Cada conta respeita seu calendário e fuso local. As configurações, a seleção e os valores foram preservados no momento da geração.",9,C.muted);
  if(input.data.selectedAccountIds.length>1)text("Alcance e cliques únicos entre contas são estimados pela soma dos agregados da Meta; pessoas podem se repetir. Frequência = impressões / alcance estimado.",9,C.muted);
  input.data.warnings.forEach(warning=>text(warning,9,C.muted));
  const total=doc.getNumberOfPages();for(let page=1;page<=total;page++){doc.setPage(page);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(C.muted);doc.text(`iGrow Reports | ${page} / ${total}`,18,290);}
  return doc;
}

export async function downloadDashboardPdf(input: DashboardPdfInput) {
  const safeName = input.clientName.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80);
  buildDashboardPdf(input).save(`${safeName}-${input.data.dateFrom}-${input.data.dateTo}${input.orientation === "horizontal" ? "-apresentacao" : ""}.pdf`);
}

export async function downloadSavedReportPdf(clientId: string, versionId: string) {
  const result = await getSavedReportDocument({ clientId, versionId });
  if ("error" in result) throw new Error(result.error);
  await downloadDashboardPdf(result.document);
}
