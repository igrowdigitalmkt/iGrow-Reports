const labels: Record<string, string> = {
  spend: "Valor usado", reach: "Alcance", impressions: "Impressões", frequency: "Frequência",
  primary_results: "Resultados", cost_per_result: "Custo por resultado",
  cpm: "CPM (custo por 1.000 impressões)", link_clicks: "Cliques no link",
  clicks: "Cliques (todos)", unique_clicks: "Cliques únicos (todos)",
  ctr_link: "CTR (taxa de cliques no link)", cpc_link: "CPC (custo por clique no link)",
  ctr: "CTR (todos)", cpc: "CPC (todos)", cpp: "Custo por 1.000 pessoas alcançadas",
  inline_post_engagement: "Engajamento com a publicação", outbound_clicks: "Cliques de saída",
  unique_outbound_clicks: "Cliques de saída únicos", unique_inline_link_clicks: "Cliques únicos no link",
  unique_inline_link_click_ctr: "CTR único (taxa de cliques no link)", unique_ctr: "CTR único (todos)",
  outbound_clicks_ctr: "CTR de saída", unique_outbound_clicks_ctr: "CTR de saída único",
  video_plays: "Reproduções do vídeo", video_p25: "Reproduções de 25% do vídeo",
  video_p50: "Reproduções de 50% do vídeo", video_p75: "Reproduções de 75% do vídeo",
  video_p95: "Reproduções de 95% do vídeo", video_p100: "Reproduções de 100% do vídeo",
  social_spend: "Valor usado social", instagram_profile_visits: "Visitas ao perfil do Instagram",
  profile_visit_view: "Visitas ao perfil do Instagram",
  instagram_profile_follow: "Seguidores do Instagram", estimated_ad_recallers: "Aumento estimado da lembrança do anúncio (pessoas)",
  attributed_revenue: "Valor de conversão", roas: "Retorno sobre o investimento em publicidade (ROAS)",
  "action:link_click": "Cliques no link", "action:landing_page_view": "Visualizações da página de destino",
  "action:profile_visit_view": "Visitas ao perfil do Instagram",
  "action:post_engagement": "Engajamento com a publicação", "action:page_engagement": "Engajamento com a Página",
  "action:post_reaction": "Reações à publicação", "action:comment": "Comentários na publicação",
  "action:post": "Compartilhamentos da publicação", "action:onsite_conversion.post_save": "Salvamentos da publicação",
  "action:like": "Curtidas na Página", "action:video_view": "Reproduções do vídeo por no mínimo 3 segundos",
  "action:onsite_conversion.messaging_conversation_started_7d": "Conversas por mensagem iniciadas",
  "action:onsite_conversion.messaging_first_reply": "Novos contatos de mensagem",
  "action:onsite_conversion.total_messaging_connection": "Contatos de mensagem",
  "action:complete_registration": "Cadastros concluídos", "action:omni_complete_registration": "Cadastros concluídos",
  "action:offsite_conversion.fb_pixel_complete_registration": "Cadastros concluídos no site",
  "action:lead": "Leads", "action:onsite_conversion.lead_grouped": "Leads na Meta",
  "action:offsite_conversion.fb_pixel_lead": "Leads no site", "action:omni_purchase": "Compras",
  "action:purchase": "Compras", "action:offsite_conversion.fb_pixel_purchase": "Compras no site",
  "action:omni_add_to_cart": "Adições ao carrinho", "action:add_to_cart": "Adições ao carrinho",
  "action:omni_initiated_checkout": "Finalizações de compra iniciadas",
  "action:offsite_conversion.fb_pixel_initiate_checkout": "Finalizações de compra iniciadas no site",
  "action:omni_view_content": "Visualizações de conteúdo",
  "action:offsite_conversion.fb_pixel_view_content": "Visualizações de conteúdo no site",
  "action:omni_landing_page_view": "Visualizações da página de destino (todos os canais)",
  "action:onsite_conversion.messaging_conversation_replied_7d": "Conversas por mensagem respondidas",
  "action:onsite_conversion.messaging_block": "Bloqueios de mensagens",
  "action:onsite_conversion.post_unlike": "Descurtidas da publicação",
  "action:onsite_conversion.post_net_like": "Curtidas líquidas da publicação",
  "action:onsite_conversion.post_net_comment": "Comentários líquidos da publicação",
  "action:onsite_conversion.post_net_save": "Salvamentos líquidos da publicação",
  "action:post_interaction_gross": "Interações com a publicação (brutas)",
  "action:post_interaction_net": "Interações com a publicação (líquidas)",
  "action:onsite_conversion.lead": "Leads na Meta", "action:omni_lead": "Leads",
  "action:onsite_web_lead": "Leads no site", "action:contact_total": "Contatos",
  "action:onsite_conversion.flow_complete": "Formulários instantâneos concluídos",
  "action:onsite_app_purchase": "Compras no app", "action:omni_app_install": "Instalações do app",
};

const offsiteEvents: Record<string, string> = {
  complete_registration: "Cadastro concluído", lead: "Lead", purchase: "Compra", add_to_cart: "Adição ao carrinho",
  initiate_checkout: "Finalização de compra iniciada", view_content: "Visualização de conteúdo",
  contact: "Contato", schedule: "Agendamento", submit_application: "Inscrição enviada", search: "Pesquisa",
};

function words(value: string) {
  return value.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

// Readable names for action types without a curated label. Custom pixel events
// ("offsite_<event>_add_<name>") keep the advertiser-defined name visible.
function actionLabel(key: string): string | null {
  const type = key.slice("action:".length);
  const depth = /^onsite_conversion\.messaging_user_depth_(\d+)_message_send$/.exec(type);
  if (depth) return `Contatos com ${depth[1]} mensagens enviadas`;
  const custom = /^offsite_([a-z_]+?)_add_(.+)$/.exec(type);
  if (custom) return `${offsiteEvents[custom[1]] ?? words(custom[1])} (evento personalizado: ${words(custom[2])})`;
  if (type.startsWith("offsite_conversion.custom.")) return `Conversão personalizada ${type.slice("offsite_conversion.custom.".length)}`;
  if (type.startsWith("offsite_conversion.fb_pixel_custom")) return "Evento personalizado do pixel";
  const prefix = type.startsWith("onsite_conversion.") ? "na Meta" : type.startsWith("offsite_conversion.") ? "no site" : null;
  const base = type.replace(/^(onsite|offsite)_conversion\./, "").replace(/^omni_/, "");
  const known = labels[`action:${base}`];
  if (known) return prefix ? `${known} ${prefix}` : known;
  return null;
}

export function metaMetricLabel(key: string, fallback: string): string {
  if (key.startsWith("cost:action:")) return `Custo por ${metaMetricLabel(key.slice(5), fallback.replace(/^Custo por /i, "")).toLocaleLowerCase("pt-BR")}`;
  if (key.startsWith("value:action:")) return `Valor de conversão de ${metaMetricLabel(key.slice(6), fallback.replace(/^Valor de conversão de /i, "")).toLocaleLowerCase("pt-BR")}`;
  const label = labels[key];
  if (label) return label;
  if (fallback === key && key.startsWith("action:")) {
    const readable = actionLabel(key);
    if (readable) return readable;
    return `Ação Meta: ${words(key.slice("action:".length))}`;
  }
  return fallback;
}
