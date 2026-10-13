-- Texto de IA em mensagens agendadas: o envio espera a aprovação do responsável.
-- A rodada fica em 'awaiting_approval' com o texto gerado em ai_text; ao aprovar vira envio normal, ao descartar vira 'discarded'.
alter table public.report_automation_runs add column ai_text text check (char_length(ai_text) <= 3000);
alter table public.report_automation_runs drop constraint report_automation_runs_status_check;
alter table public.report_automation_runs add constraint report_automation_runs_status_check
  check (status in ('running','sent','partial','failed','skipped','awaiting_approval','discarded'));

alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('report_comment','portfolio_summary','whatsapp_summary'));
