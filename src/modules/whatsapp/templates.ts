export type WhatsAppTemplateComponent = { type: string; format?: string; text?: string };
export type WhatsAppTemplate = { name: string; language: string; status: string; category?: string; components?: WhatsAppTemplateComponent[] };

// A report goes as a PDF in the message header, so only approved templates with a
// DOCUMENT header can carry it.
export function reportTemplates(templates: WhatsAppTemplate[]) {
  return templates.filter(template => template.status === "APPROVED"
    && template.components?.some(component => component.type === "HEADER" && component.format === "DOCUMENT"));
}

export function bodyParameterCount(template: Pick<WhatsAppTemplate, "components">) {
  const body = template.components?.find(component => component.type === "BODY")?.text ?? "";
  const numbers = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1]));
  return numbers.length ? Math.max(...numbers) : 0;
}

/**
 * Body variables in the order of the suggested template:
 * {{1}} recipient name, {{2}} client name, {{3}} period, {{4}} workspace name.
 */
export function bodyParameters(count: number, values: { recipient: string; client: string; period: string; workspace: string }) {
  const ordered = [values.recipient, values.client, values.period, values.workspace];
  return Array.from({ length: count }, (_, index) => ({ type: "text" as const, text: (ordered[index] ?? values.client).slice(0, 1000) }));
}

export const SUGGESTED_TEMPLATE = {
  name: "relatorio_desempenho",
  language: "pt_BR",
  category: "UTILITY",
  header: "Documento (PDF)",
  body: "Olá, {{1}}! O relatório de desempenho de {{2}}, referente ao período {{3}}, está no arquivo acima. Qualquer dúvida, fale com a equipe {{4}}.",
};
