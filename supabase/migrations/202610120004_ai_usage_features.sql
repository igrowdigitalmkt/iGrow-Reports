-- Novo tipo de uso de IA: resumo da carteira de clientes (além do comentário de relatório).
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('report_comment','portfolio_summary'));
