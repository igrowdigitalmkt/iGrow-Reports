-- Contabiliza o custo do motor de decisao do agente na mesma tabela e cota mensal
-- que ja controlam a IA de texto. NAO aplicada em producao.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('report_comment','portfolio_summary','whatsapp_summary','agent_decision'));
