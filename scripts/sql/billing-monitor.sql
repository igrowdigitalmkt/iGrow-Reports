-- Monitoramento FINANCEIRO (somente leitura) para a homologação/produção. Rodar no editor SQL do Supabase ou por ferramenta de leitura.
-- Não mostra credenciais nem dados pessoais: organizações pelo nome (fictício em homologação) e identificadores truncados.
-- Parâmetro opcional: troque o filtro de organização (linha "org_filter") para acompanhar só uma organização de teste.
with org_filter as (select '%'::text as pattern), -- ex.: 'TESTE-2.2D %'
agencies_f as (select a.id, a.name from public.agencies a, org_filter f where a.name like f.pattern),
pend as (
  select a.name, i.status, left(i.id::text, 8) as intent, round(extract(epoch from (now() - coalesce(i.dispatched_at, i.created_at))) / 60) as idade_min,
         i.recovery_checked_at as ultima_conferencia, i.review_required_at is not null as em_revisao, i.verified_after_expiry_at is not null as conferida
  from private.billing_checkout_intents i join agencies_f a on a.id = i.agency_id
  where i.status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') or (i.status = 'expired' and i.verified_after_expiry_at is null)
),
conf_nao_ativada as (
  select a.name, p.status as cobranca, s.status as assinatura, left(p.asaas_payment_id, 12) as pagamento
  from private.billing_payments p join private.billing_subscriptions s on s.id = p.subscription_id join agencies_f a on a.id = s.agency_id
  where p.status in ('CONFIRMED', 'RECEIVED') and s.status in ('pending', 'canceled')
),
ev as (select status, count(*) n, min(received_at) as mais_antigo from private.billing_events group by status),
conflitos as (
  select a.name, s.attention_reason as motivo from private.billing_subscriptions s join agencies_f a on a.id = s.agency_id where s.attention_reason is not null
  union all
  select a.name, l.action from private.billing_audit_log l join agencies_f a on a.id = l.agency_id
   where l.action in ('subscription.unlinked_candidate', 'subscription.duplicate_detected', 'payment.unlinked', 'subscription.cross_organization_checkout') and l.at > now() - interval '7 days'
),
ativacoes as (
  select a.name, l.at as ativada_em, i.dispatched_at as checkout_enviado_em, round(extract(epoch from (l.at - i.dispatched_at)) / 60, 1) as minutos_desde_o_checkout,
         case when (l.metadata ->> 'event_id') is null then 'sem webhook (cron/reconciliação)' else 'via webhook (evento ' || (l.metadata ->> 'event_id') || ')' end as origem,
         exists (select 1 from private.billing_events e where e.received_at < l.at and (e.resource_id in (s.asaas_subscription_id, i.asaas_checkout_id) or e.resource_id in (select p.asaas_payment_id from private.billing_payments p where p.subscription_id = s.id))) as webhook_recebeu_antes
  from private.billing_audit_log l join agencies_f a on a.id = l.agency_id
  join private.billing_subscriptions s on s.id = l.subscription_id left join private.billing_checkout_intents i on i.id = s.intent_id
  where l.action = 'subscription.activated' order by l.at desc limit 10
)
select jsonb_build_object(
  'agora', now(),
  'intencoes_pendentes_ou_nao_conferidas', coalesce((select jsonb_agg(to_jsonb(p) order by p.idade_min desc) from pend p), '[]'::jsonb),
  'ultima_conferencia_financeira', (select max(i.recovery_checked_at) from private.billing_checkout_intents i join agencies_f a on a.id = i.agency_id),
  'ultima_reconciliacao_de_assinatura', (select max(s.last_reconciled_at) from private.billing_subscriptions s join agencies_f a on a.id = s.agency_id),
  'assinaturas_pendentes', (select count(*) from private.billing_subscriptions s join agencies_f a on a.id = s.agency_id where s.status = 'pending'),
  'pagamentos_confirmados_nao_ativados', coalesce((select jsonb_agg(to_jsonb(c)) from conf_nao_ativada c), '[]'::jsonb),
  'eventos_por_status', coalesce((select jsonb_object_agg(status, jsonb_build_object('n', n, 'mais_antigo', mais_antigo)) from ev), '{}'::jsonb),
  'conflitos_e_revisoes', coalesce((select jsonb_agg(to_jsonb(c)) from conflitos c), '[]'::jsonb),
  'ultimas_ativacoes', coalesce((select jsonb_agg(to_jsonb(x)) from ativacoes x), '[]'::jsonb)
) as monitor;
