import { Document, Page, Text, View } from "@react-pdf/renderer";
import { Children, type ReactNode } from "react";
import { brDate, int, money, share, shortDate } from "../format";
import { reportUpdatedAt } from "../report-presentation";
import type { ReportFacts } from "../report-facts";
import { AreaChart, Donut } from "./charts";
import { analysisLines, changeLabel, summaryParts, toneFor, type Tone } from "./summary";
import { COLORS, PALETTE, SIZE } from "./theme";
import type { PdfBlockKey, ReportPdfInput } from "./types";

type Ctx = { input: ReportPdfInput; facts: ReportFacts; brand: string; period: string; on: (key: PdfBlockKey) => boolean };

const toneColor = (tone: Tone) => tone === "good" ? COLORS.good : tone === "bad" ? COLORS.bad : COLORS.muted;

// Capa de cada seção do relatório (uma por conta ou plataforma): as informações do cabeçalho, centralizadas na página.
function SectionCoverPage({ ctx }: { ctx: Ctx }) {
  return (
    <Page size="A4" style={{ fontFamily: "Inter", color: COLORS.ink, backgroundColor: COLORS.tint, justifyContent: "center", alignItems: "center", padding: SIZE.page }}>
      <View style={{ alignItems: "center", maxWidth: 440 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 36 }}>
          <View style={{ width: 44, height: 44, borderRadius: 11, backgroundColor: ctx.brand, marginRight: 14 }} />
          <Text style={{ fontSize: 24, fontWeight: 700 }}>{ctx.input.workspaceName}</Text>
        </View>
        <Text style={{ fontSize: 16, color: ctx.brand, fontWeight: 500, letterSpacing: 1.6, marginBottom: 14, textAlign: "center" }}>{`RELATÓRIO DE DESEMPENHO · ${(ctx.input.platformLabel ?? "Meta Ads").toUpperCase()}`}</Text>
        <Text style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.1, textAlign: "center" }}>{ctx.input.clientName}</Text>
        {ctx.input.accountLabel ? <Text style={{ fontSize: 24, fontWeight: 700, marginTop: 16, color: ctx.brand, textAlign: "center" }}>{`Conta: ${ctx.input.accountLabel}`}</Text> : null}
        <View style={{ marginTop: 24, backgroundColor: COLORS.white, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 20, borderWidth: 0.7, borderColor: COLORS.line }}>
          <Text style={{ fontSize: 19, color: COLORS.muted, fontWeight: 500 }}>{ctx.period}</Text>
        </View>
      </View>
    </Page>
  );
}

function MiniHeader({ ctx }: { ctx: Ctx }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, marginBottom: 20, borderBottomWidth: 0.7, borderBottomColor: COLORS.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginRight: 12 }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: ctx.brand, marginRight: 8 }} />
        <Text style={{ fontSize: 14, fontWeight: 700 }}>{ctx.input.workspaceName}</Text>
      </View>
      <Text style={{ fontSize: 13.5, color: COLORS.muted, flexShrink: 1, textAlign: "right" }}>{`${ctx.input.clientName}${ctx.input.accountLabel ? `  ·  ${ctx.input.accountLabel}` : ""}  ·  ${ctx.period}`}</Text>
    </View>
  );
}

// O título fica sempre junto do primeiro bloco, para nunca terminar sozinho no pé da página.
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const [first, ...rest] = Children.toArray(children);
  return (
    <>
      <View wrap={false}>
        <Text style={{ fontSize: SIZE.h2, fontWeight: 700, marginBottom: subtitle ? 2 : 10 }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: SIZE.note, color: COLORS.muted, marginBottom: 10 }}>{subtitle}</Text> : null}
        {first}
      </View>
      {rest}
      <View style={{ height: 22 }} />
    </>
  );
}

const Note = ({ children, style }: { children: ReactNode; style?: object }) => <Text style={{ fontSize: SIZE.note, color: COLORS.muted, lineHeight: 1.45, ...style }}>{children}</Text>;

function Kpi({ label, value, delta, tone, big, full }: { label: string; value: string; delta: string; tone: Tone; big?: boolean; full?: boolean }) {
  return (
    <View style={{ ...(full ? { width: "100%" } : { flexGrow: 1, flexBasis: 0 }), backgroundColor: COLORS.paper, borderRadius: 10, padding: 12 }}>
      <Text style={{ fontSize: SIZE.label, color: COLORS.muted }}>{label}</Text>
      <Text style={{ fontSize: big ? SIZE.valueBig : SIZE.value, fontWeight: 700, marginTop: 4 }}>{value}</Text>
      <Text style={{ fontSize: SIZE.label, marginTop: 5, color: toneColor(tone) }}>{delta}</Text>
    </View>
  );
}

function Cover({ ctx }: { ctx: Ctx }) {
  const { facts } = ctx;
  const comparable = facts.period.comparable;
  return (
    <>
      <Text style={{ fontSize: SIZE.summary, lineHeight: 1.45, marginBottom: 14 }}>
        {summaryParts(facts).map((part, index) => <Text key={index} style={part.bold ? { fontWeight: 700 } : undefined}>{part.text}</Text>)}
      </Text>
      <View style={{ marginBottom: 16 }}>
        <Kpi full big label="Valor usado" value={facts.spend.current == null ? "Indisponível" : money(facts.spend.current, facts.currency)}
          delta={changeLabel(facts.spend.changePct, comparable)} tone="neutral" />
      </View>
      <Section title="Resultados e custo por resultado" subtitle="Cada tipo tem custo próprio e não é somado aos demais.">
        {facts.results.length === 0
          ? <Note>Nenhum tipo de resultado confirmado neste período.</Note>
          : facts.results.map(result => (
            <View key={result.key} wrap={false} style={{ borderWidth: 0.7, borderColor: COLORS.line, borderRadius: 10, padding: 10, marginBottom: 7 }}>
              <Text style={{ fontSize: 15, color: COLORS.muted, marginBottom: 2 }}>{result.label}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <View>
                  <Text style={{ fontSize: 28, fontWeight: 700 }}>{int(result.quantity)}</Text>
                  <Text style={{ fontSize: 12.5, color: toneColor(toneFor(result.changePct, "up")) }}>
                    {result.previousQuantity === 0 && comparable ? "Sem registro no período anterior" : changeLabel(result.changePct, comparable)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 20, fontWeight: 700 }}>{result.costPerResult == null ? "—" : money(result.costPerResult, facts.currency)}</Text>
                  <Text style={{ fontSize: 12.5, color: COLORS.muted }}>{result.costPerResult == null ? "custo indisponível" : "custo por resultado"}</Text>
                </View>
              </View>
            </View>
          ))}
      </Section>
    </>
  );
}

function Delivery({ ctx }: { ctx: Ctx }) {
  const { facts } = ctx, d = facts.delivery, comparable = facts.period.comparable;
  const money2 = (value: number | null) => value == null ? "Indisponível" : money(value, facts.currency);
  return (
    <Section title="Alcance e entrega">
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
        <Kpi label="Alcance" value={d.reach.current == null ? "Indisponível" : int(d.reach.current)} delta={changeLabel(d.reach.changePct, comparable)} tone={toneFor(d.reach.changePct, "up")} />
        <Kpi label="Impressões" value={d.impressions.current == null ? "Indisponível" : int(d.impressions.current)} delta={changeLabel(d.impressions.changePct, comparable)} tone={toneFor(d.impressions.changePct, "up")} />
        <Kpi label="CPM" value={money2(d.cpm.current)} delta={changeLabel(d.cpm.changePct, comparable)} tone={toneFor(d.cpm.changePct, "down")} />
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
        <Kpi label="Cliques no link" value={d.linkClicks.current == null ? "Indisponível" : int(d.linkClicks.current)} delta={changeLabel(d.linkClicks.changePct, comparable)} tone={toneFor(d.linkClicks.changePct, "up")} />
        <Kpi label="Vezes que cada pessoa viu" value={d.frequency.current == null ? "Indisponível" : d.frequency.current.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} delta={changeLabel(d.frequency.changePct, comparable)} tone="neutral" />
      </View>
      {d.reachEstimated ? <Note>Alcance estimado entre contas: a mesma pessoa pode ser contada mais de uma vez.</Note> : null}
    </Section>
  );
}

function Performance({ ctx }: { ctx: Ctx }) {
  const { data } = ctx.input;
  const labels = data.daily.map(day => shortDate(day.date));
  const spend = data.daily.map(day => day.values.spend ?? null);
  const clicks = data.daily.map(day => day.values.link_clicks ?? null);
  const hasClicks = clicks.some(value => value != null);
  if (!spend.some(value => value != null)) return null;
  return (
    <Section title="Desempenho do período" subtitle="Evolução dia a dia. Dias sem dado confirmado ficam em branco.">
      <View wrap={false}>
        <Text style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Valor usado por dia</Text>
        <AreaChart values={spend} labels={labels} color="#378ADD" format={value => money(value, ctx.facts.currency).replace(",00", "")} />
      </View>
      {hasClicks ? (
        <View wrap={false} style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Cliques no link por dia</Text>
          <AreaChart values={clicks} labels={labels} color={COLORS.chart2} format={value => int(value)} />
        </View>
      ) : null}
    </Section>
  );
}

function Analysis({ ctx }: { ctx: Ctx }) {
  const note = ctx.input.analysisNote?.trim();
  if (!note) return null;
  return (
    <View wrap={false} style={{ borderWidth: 0.7, borderColor: COLORS.line, borderLeftWidth: 5, borderLeftColor: ctx.brand, borderRadius: 6, backgroundColor: COLORS.paper, padding: 16, marginBottom: 22 }}>
      <Text style={{ fontSize: SIZE.note, color: ctx.brand, fontWeight: 500, letterSpacing: 1, marginBottom: 8 }}>ANÁLISE E DIRECIONAMENTOS</Text>
      {analysisLines(note).map((parts, index) => (
        <Text key={index} style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 6 }}>
          {parts.map((part, position) => <Text key={position} style={part.bold ? { fontWeight: 700 } : undefined}>{part.text}</Text>)}
        </Text>
      ))}
    </View>
  );
}

function Campaigns({ ctx }: { ctx: Ctx }) {
  const { facts } = ctx;
  if (facts.campaigns.length === 0) return null;
  return (
    <Section title="Campanhas" subtitle={facts.campaignsWithSpend > facts.campaigns.length ? `As ${facts.campaigns.length} de maior investimento, de ${facts.campaignsWithSpend} no período.` : undefined}>
      {facts.campaigns.map(campaign => (
        <View key={campaign.id} wrap={false} style={{ borderWidth: 0.7, borderColor: COLORS.line, borderRadius: 10, padding: 10, marginBottom: 7 }}>
          <Text style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{campaign.name}</Text>
          <View style={{ height: 6, backgroundColor: COLORS.line, borderRadius: 3, marginBottom: 6 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: ctx.brand, width: `${Math.min(100, Math.max(1, campaign.shareOfSpend ?? 0))}%` }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: SIZE.legend }}>{`${money(campaign.spend, facts.currency)}${campaign.shareOfSpend == null ? "" : `  ·  ${share(campaign.shareOfSpend)} do investimento`}`}</Text>
          </View>
          <Text style={{ fontSize: SIZE.legend, color: COLORS.muted, marginTop: 3 }}>
            {campaign.result
              ? `${int(campaign.result.quantity)} ${campaign.result.label.toLocaleLowerCase("pt-BR")}${campaign.costPerResult == null ? "" : `  ·  ${money(campaign.costPerResult, facts.currency)} cada`}`
              : campaign.mixedResults ? "Vários tipos de resultado" : "Sem resultado confirmado"}
          </Text>
        </View>
      ))}
    </Section>
  );
}

function Accounts({ ctx }: { ctx: Ctx }) {
  const { facts } = ctx;
  const total = facts.spend.current;
  if (facts.accounts.length === 0 || total == null || total <= 0) return null;
  return (
    <Section title="Investimento por conta">
      <View wrap={false} style={{ borderWidth: 0.7, borderColor: COLORS.line, borderRadius: 10, padding: 12, alignItems: "center" }}>
        <Donut size={140} centerTop={money(total, facts.currency)} centerBottom="Valor usado" valueFont={11.5}
          items={facts.accounts.map((account, index) => ({ value: account.spend, color: PALETTE[index % PALETTE.length]! }))} />
        <View style={{ width: "100%", marginTop: 10 }}>
          {facts.accounts.map((account, index) => (
            <View key={account.name} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderTopWidth: 0.7, borderTopColor: COLORS.line }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
                <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: PALETTE[index % PALETTE.length], marginRight: 7 }} />
                <Text style={{ fontSize: 15 }}>{account.name}</Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: 700 }}>{`${money(account.spend, facts.currency)}  ·  ${share(account.shareOfSpend) ?? "—"}`}</Text>
            </View>
          ))}
        </View>
      </View>
    </Section>
  );
}

function Audience({ ctx }: { ctx: Ctx }) {
  const audience = ctx.input.audience;
  if (!audience || audience.groups.length === 0) return null;
  return (
    <View break>
      <Text style={{ fontSize: SIZE.h2, fontWeight: 700, marginBottom: 2 }}>Público do período</Text>
      <Note style={{ marginBottom: 10 }}>{`Plataformas, gênero, idade e região, direto da Meta. Indicador: ${audience.indicator}. Cada gráfico tem o próprio total.`}</Note>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
        {audience.groups.map(group => (
          <View key={group.title} wrap={false} style={{ width: "49%", borderWidth: 0.7, borderColor: COLORS.line, borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{group.title}</Text>
            <View style={{ alignItems: "center", marginBottom: 8 }}>
              <Donut size={100} centerTop={group.total} centerBottom={audience.indicator} valueFont={15}
                items={group.items.map((item, index) => ({ value: item.value, color: PALETTE[index % PALETTE.length]! }))} />
            </View>
            {group.items.map((item, index) => (
              <View key={item.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PALETTE[index % PALETTE.length], marginRight: 7 }} />
                  <Text style={{ fontSize: SIZE.legend }}>{item.label}</Text>
                </View>
                <Text style={{ fontSize: SIZE.legend, fontWeight: 700, marginLeft: 8 }}>{item.display}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Balances({ ctx }: { ctx: Ctx }) {
  const rows = ctx.input.balances;
  if (!rows || rows.length === 0) return null;
  return (
    <Section title="Saldo e pagamentos">
      {rows.map(row => (
        <View key={row.name} wrap={false} style={{ borderWidth: 0.7, borderColor: COLORS.line, borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <Text style={{ fontSize: 19, fontWeight: 700 }}>{row.name}</Text>
          <Text style={{ fontSize: 13.5, color: COLORS.muted, marginTop: 3, marginBottom: 12 }}>{row.status}</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {row.cells.map(cell => (
              <View key={cell.label} style={{ flexGrow: 1, flexBasis: 0 }}>
                <Text style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 3 }}>{cell.label}</Text>
                <Text style={{ fontSize: 18, fontWeight: 700 }}>{cell.value}</Text>
                {cell.sub ? <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>{cell.sub}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ))}
    </Section>
  );
}

function DataNotes({ ctx }: { ctx: Ctx }) {
  const { data } = ctx.input;
  const lines = [
    `Dados fornecidos pela ${ctx.input.platformLabel ?? "Meta Ads"}, confirmados em ${reportUpdatedAt(data)} (horário de Brasília). Período completo: ${data.coverage.coveredDays} de ${data.coverage.totalDays} dias.`,
    "Cada conta usa o fuso e o calendário da própria conta na plataforma.",
    ...ctx.facts.limitations,
  ];
  return (
    <View wrap={false} style={{ borderTopWidth: 0.7, borderTopColor: COLORS.line, paddingTop: 10 }}>
      <Text style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Sobre os dados</Text>
      {lines.map(line => <Note key={line} style={{ fontSize: 12, marginBottom: 3 }}>{line}</Note>)}
    </View>
  );
}

function ReportPage({ input, facts }: { input: ReportPdfInput; facts: ReportFacts }) {
  const ctx: Ctx = {
    input, facts, brand: input.brandColor ?? COLORS.brand, period: `${brDate(facts.period.from)} a ${brDate(facts.period.to)}`,
    on: key => input.blocks?.[key] !== false,
  };
  return (
    <>
      <SectionCoverPage ctx={ctx} />
      <Page size="A4" style={{ fontFamily: "Inter", color: COLORS.ink, padding: SIZE.page, paddingBottom: 60 }}>
        <View fixed><MiniHeader ctx={ctx} /></View>
        <Cover ctx={ctx} />
        {ctx.on("analysis") ? <Analysis ctx={ctx} /> : null}
        {ctx.on("delivery") ? <Delivery ctx={ctx} /> : null}
        {ctx.on("performance") ? <Performance ctx={ctx} /> : null}
        {ctx.on("campaigns") ? <Campaigns ctx={ctx} /> : null}
        {ctx.on("accounts") ? <Accounts ctx={ctx} /> : null}
        {ctx.on("audience") ? <Audience ctx={ctx} /> : null}
        {ctx.on("balances") ? <Balances ctx={ctx} /> : null}
        <DataNotes ctx={ctx} />
        <View fixed style={{ position: "absolute", bottom: 22, left: SIZE.page, right: SIZE.page, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.7, borderTopColor: COLORS.line, paddingTop: 8 }}>
          <Text style={{ fontSize: SIZE.footer, color: COLORS.faint }}>Groow Ads</Text>
          <Text style={{ fontSize: SIZE.footer, color: COLORS.faint }} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </>
  );
}

// Um relatório completo por seção (uma por conta de anúncios). Com uma só seção, é o relatório de sempre.
export function ReportDocument({ sections }: { sections: Array<{ input: ReportPdfInput; facts: ReportFacts }> }) {
  const first = sections[0].input;
  return (
    <Document title={`Relatório de desempenho - ${first.clientName}`} author={first.workspaceName} creator="Groow Ads">
      {sections.map((section, index) => <ReportPage key={index} input={section.input} facts={section.facts} />)}
    </Document>
  );
}
