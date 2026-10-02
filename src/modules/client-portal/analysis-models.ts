export const ANALYSIS_MODELS = [
  { key: "messages", name: "Mensagens", metrics: ["action:onsite_conversion.messaging_conversation_started_7d", "link_clicks", "cpc_link", "ctr_link", "frequency"] },
  { key: "leads", name: "Leads", metrics: ["action:lead", "action:offsite_conversion.fb_pixel_lead", "link_clicks", "cpc_link", "ctr_link", "frequency"] },
  { key: "sales", name: "Vendas", metrics: ["attributed_revenue", "roas", "action:purchase", "action:offsite_conversion.fb_pixel_purchase", "link_clicks", "frequency"] },
  { key: "awareness", name: "Reconhecimento", metrics: ["frequency", "clicks", "inline_post_engagement", "ctr_link"] },
] as const;

export function modelMetrics(keys: readonly string[], available: readonly string[]) {
  const catalog = new Set(available);
  return [...new Set([...keys, "frequency"])].filter(key => catalog.has(key));
}

export function moveMetric(keys: string[], key: string, direction: -1 | 1) {
  const index = keys.indexOf(key);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= keys.length) return keys;
  const result = [...keys];
  [result[index], result[destination]] = [result[destination], result[index]];
  return result;
}
