begin;
set local search_path=public,extensions;
select no_plan();

-- Fixtures fictícias: duas organizações com assinatura ativa (vencendo hoje, para entrar na reconciliação) e um plano publicado.
insert into auth.users(id,email,email_confirmed_at) values ('2e000000-0000-4000-8000-000000000001','dono@example.test',now());
insert into agencies(id,name) select ('2eaaaaaa-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'Org '||n from generate_series(1,3) n;
insert into agency_users(agency_id,user_id,role) select ('2eaaaaaa-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, '2e000000-0000-4000-8000-000000000001', 'owner' from generate_series(1,3) n;
insert into private.plans(id,key,name,description,visibility,sellable,recommended,sort_order) values ('2ebbbbbb-0000-4000-8000-000000000001','pro','Profissional','x','public',true,true,10);
insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values ('2ecccccc-0000-4000-8000-000000000001','2ebbbbbb-0000-4000-8000-000000000001',1,4990,49900);
insert into private.plan_version_entitlements(plan_version_id,key,limit_value) values ('2ecccccc-0000-4000-8000-000000000001','clients',10);
update private.plan_versions set status='published',published_at=now() where id='2ecccccc-0000-4000-8000-000000000001';
update private.plans set current_version_id='2ecccccc-0000-4000-8000-000000000001' where id='2ebbbbbb-0000-4000-8000-000000000001';

create function public.zz_active(p_n int) returns void language plpgsql as $$
declare v_agency uuid := ('2eaaaaaa-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid; v_cust text := 'cus_M'||p_n; v_chk text := 'chk_M'||p_n; v_int uuid;
begin
  perform public.billing_set_customer(v_agency,'sandbox',v_cust);
  v_int := (public.billing_create_intent(v_agency,'2e000000-0000-4000-8000-000000000001','2ecccccc-0000-4000-8000-000000000001','monthly','chave-monitor-'||p_n||'-000001','sandbox') ->> 'intent_id')::uuid;
  perform public.billing_mark_intent(v_int,'dispatching');
  perform public.billing_mark_intent(v_int,'awaiting_payment',v_chk,'https://sandbox.example.test/'||v_chk);
  perform public.billing_apply_subscription('sandbox',jsonb_build_object('id','sub_M'||p_n,'customer',v_cust,'value',49.90,'cycle','MONTHLY','status','ACTIVE','billingType','CREDIT_CARD','checkoutSession',v_chk));
  perform public.billing_apply_payment('sandbox',jsonb_build_object('id','pay_M'||p_n,'subscription','sub_M'||p_n,'customer',v_cust,'value',49.90,'dueDate',current_date,'status','CONFIRMED','billingType','CREDIT_CARD','confirmedDate',current_date,'observedAt',now()));
end $$;

-- ======================= PERMISSÕES =======================
select ok(has_function_privilege('service_role','public.billing_cron_start(text)','execute')
  and has_function_privilege('service_role','public.billing_cron_finish(uuid,text,integer,integer,jsonb,text)','execute')
  and has_function_privilege('service_role','public.billing_cron_health(text)','execute')
  and has_function_privilege('service_role','public.billing_restricted_agency_ids()','execute')
  and has_function_privilege('service_role','public.billing_mark_synthetic(uuid,boolean,text)','execute'),'Monitoramento e marcação de fictícios: executáveis pelo servidor');
select ok(not has_function_privilege('authenticated','public.billing_cron_start(text)','execute') and not has_function_privilege('anon','public.billing_cron_health(text)','execute')
  and not has_function_privilege('authenticated','public.billing_restricted_agency_ids()','execute') and not has_function_privilege('authenticated','public.billing_mark_synthetic(uuid,boolean,text)','execute')
  and not has_table_privilege('authenticated','private.billing_cron_runs','select'),'Nenhuma dessas funções nem a tabela de execuções é acessível por usuário ou anônimo');

-- ======================= EXECUÇÕES E SAÚDE =======================
select is(public.billing_cron_health('sandbox') ->> 'ok','false','Sem nenhuma execução: alerta');
select ok((public.billing_cron_health('sandbox') ->> 'flags') like '%never_ran%','... com a marca never_ran');

create temp table zz_run(id uuid);
insert into zz_run select public.billing_cron_start('sandbox');
select is((select status from private.billing_cron_runs where id=(select id from zz_run)),'running','Início registra a execução como running');
select public.billing_cron_finish((select id from zz_run),'success',7,0,'{"ev_processed":3,"rec_checked":4}'::jsonb,null);
select is((select status||'/'||items_processed||'/'||failures||'/'||(counts->>'rec_checked') from private.billing_cron_runs where id=(select id from zz_run)),'success/7/0/4','Conclusão grava estado, itens, falhas e contagens');
select ok((select duration_ms is not null and finished_at is not null from private.billing_cron_runs where id=(select id from zz_run)),'Duração e horário de término gravados');
select is(public.billing_cron_health('sandbox') ->> 'ok','true','Execução bem-sucedida recente e sem acúmulo: saudável');
select is(public.billing_cron_health('production') ->> 'ok','false','Ambientes são separados: produção continua sem execução');
select throws_ok($$select public.billing_cron_start('outro')$$,'22023',null,'Ambiente inválido é recusado');
select throws_ok($$select public.billing_cron_finish((select id from zz_run),'estranho')$$,'22023',null,'Estado inválido é recusado');
select lives_ok($$select public.billing_cron_finish((select id from zz_run),'failed',0,1,'{}'::jsonb,'tentativa_tardia')$$,'Fechar de novo uma execução já concluída não altera nada');
select is((select status from private.billing_cron_runs where id=(select id from zz_run)),'success','... o estado original permanece');
select throws_ok($$insert into private.billing_cron_runs(environment,counts) values ('sandbox','[1]'::jsonb)$$,'23514',null,'Contagens precisam ser um objeto pequeno');
select throws_ok($$insert into private.billing_cron_runs(environment,error_code) values ('sandbox','Mensagem com segredo!')$$,'23514',null,'O código de erro é um identificador curto, nunca texto livre');

-- Sem sucesso há mais de 15 minutos.
delete from private.billing_cron_runs;
insert into private.billing_cron_runs(environment,started_at,finished_at,status) values ('sandbox',now()-interval '21 minutes',now()-interval '20 minutes','success');
select is(public.billing_cron_health('sandbox') ->> 'ok','false','Último sucesso há 20 min: alerta');
select ok((public.billing_cron_health('sandbox') ->> 'flags') like '%no_recent_success%','... marca no_recent_success');
insert into private.billing_cron_runs(environment,started_at,finished_at,status) values ('sandbox',now()-interval '5 minutes',now()-interval '4 minutes','success');
select is(public.billing_cron_health('sandbox') ->> 'ok','true','Sucesso há 4 min: volta a ficar saudável');

-- Três execuções seguidas sem sucesso (falha ou parcial) depois do último sucesso.
delete from private.billing_cron_runs;
insert into private.billing_cron_runs(environment,started_at,finished_at,status) values
  ('sandbox',now()-interval '14 minutes',now()-interval '13 minutes','success'),
  ('sandbox',now()-interval '10 minutes',now()-interval '9 minutes','failed'),
  ('sandbox',now()-interval '6 minutes',now()-interval '5 minutes','partial'),
  ('sandbox',now()-interval '2 minutes',now()-interval '1 minutes','failed');
select ok((public.billing_cron_health('sandbox') ->> 'flags') like '%consecutive_failures%','Três execuções seguidas sem sucesso: marca consecutive_failures');
select is((public.billing_cron_health('sandbox') ->> 'consecutive_non_success')::int,3,'... e a contagem é 3');

-- Acúmulo de eventos: pendente há mais de 30 minutos.
delete from private.billing_cron_runs;
insert into private.billing_cron_runs(environment,started_at,finished_at,status) values ('sandbox',now()-interval '3 minutes',now()-interval '2 minutes','success');
select is(public.billing_cron_health('sandbox') ->> 'ok','true','Base saudável antes do acúmulo');
insert into private.billing_events(environment,asaas_event_id,event_type,resource_type,payload,status,received_at) values ('sandbox','evt_pendente_antigo_01','PAYMENT_CONFIRMED','payment','{}'::jsonb,'received',now()-interval '40 minutes');
select ok((public.billing_cron_health('sandbox') ->> 'flags') like '%events_backlog%','Evento pendente há 40 min: marca events_backlog');
select ok((public.billing_cron_health('sandbox') #>> '{backlog,oldest_pending_event_minutes}')::numeric >= 39,'... com a idade do evento mais antigo');
update private.billing_events set status='processed',processed_at=now() where asaas_event_id='evt_pendente_antigo_01';
select is(public.billing_cron_health('sandbox') ->> 'ok','true','Evento processado: alerta some');

-- Execução esquecida em "running" vira falha com código fixo; histórico antigo é apagado.
delete from private.billing_cron_runs;
insert into private.billing_cron_runs(environment,started_at,status) values ('sandbox',now()-interval '25 minutes','running');
insert into private.billing_cron_runs(environment,started_at,finished_at,status) values ('sandbox',now()-interval '40 days',now()-interval '40 days','success');
select public.billing_cron_start('sandbox');
select is((select count(*)::int from private.billing_cron_runs where status='failed' and error_code='cron_timeout'),1,'Execução parada há 25 min vira failed/cron_timeout');
select is((select count(*)::int from private.billing_cron_runs where started_at < now()-interval '30 days'),0,'Histórico com mais de 30 dias é apagado (só o do monitoramento)');

-- ======================= ORGANIZAÇÕES COM ACESSO RESTRITO =======================
select public.zz_active(1);
select public.zz_active(2);
select is(public.billing_restricted_agency_ids(),'{}'::uuid[],'Ninguém restrito: lista vazia');
update private.agency_plan_assignments set access_state='restricted' where agency_id='2eaaaaaa-0000-4000-8000-000000000002';
select is(public.billing_restricted_agency_ids(),array['2eaaaaaa-0000-4000-8000-000000000002']::uuid[],'Só a organização restrita aparece (as demais, incluindo as sem plano, não)');

-- ======================= REGISTROS FICTÍCIOS FORA DA RECONCILIAÇÃO =======================
update private.billing_subscriptions set next_due_date=current_date;
update private.billing_checkout_intents set dispatched_at=now()-interval '10 minutes', status='awaiting_payment';
update private.billing_subscriptions set remote_cancel_pending=true where asaas_subscription_id='sub_M2';
select is((select jsonb_array_length(public.billing_reconcile_work(20,'sandbox') -> 'reconcile')),2,'Antes de marcar: as duas assinaturas entram na reconciliação');
update private.billing_subscriptions set reconcile_attempted_at=null; update private.billing_checkout_intents set recovery_checked_at=null;
select is(public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000002'::uuid,true,'Fictícia de teste sem contrapartida no Asaas'),1,'Marcar como fictícia afeta apenas o cliente financeiro dessa organização');
select is((select synthetic from private.billing_customers where agency_id='2eaaaaaa-0000-4000-8000-000000000001'),false,'A outra organização continua real');
select is((public.billing_reconcile_work(20,'sandbox') -> 'reconcile' -> 0 ->> 'asaas_subscription_id'),'sub_M1','Depois de marcar: só a organização real é reconferida');
select is((select jsonb_array_length(public.billing_reconcile_work(20,'sandbox') -> 'reconcile')),0,'... e a fictícia não volta');
select is((select jsonb_array_length(public.billing_reconcile_work(20,'sandbox') -> 'remote_cancel')),0,'Cancelamento remoto pendente de organização fictícia não chama o Asaas');
select is((select jsonb_array_length(public.billing_reconcile_work(20,'sandbox') -> 'intents')),0,'Intenções da fictícia não são conferidas (a da real já foi reivindicada nesta janela)');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2eaaaaaa-0000-4000-8000-000000000002' and status='active'),1,'Nada foi alterado na assinatura fictícia');
update private.billing_subscriptions set reconcile_attempted_at=null;
select public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000002'::uuid,false,'Desmarcada para voltar à reconciliação normal');
select is((select jsonb_array_length(public.billing_reconcile_work(20,'sandbox') -> 'remote_cancel')),1,'Desmarcar devolve a organização à reconciliação normal');


-- ======================= PROTEÇÕES DA MARCAÇÃO =======================
select throws_ok($$select public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000002'::uuid,true,null)$$,'22023',null,'Marcar exige motivo');
select throws_ok($$select public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000002'::uuid,true,'curto')$$,'22023',null,'Motivo curto demais é recusado');
select throws_ok($$select public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000003'::uuid,true,'Organização sem cliente financeiro algum')$$,'P0002',null,'Organização sem cliente financeiro não é marcada (nada é criado)');
select public.billing_set_customer('2eaaaaaa-0000-4000-8000-000000000003'::uuid,'sandbox','cus_000009999999');
select throws_ok($$select public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000003'::uuid,true,'Tentativa indevida de excluir organização real')$$,'42501',null,'Cliente financeiro com identificador real do Asaas NÃO pode ser marcado como fictício');
select is((select synthetic from private.billing_customers where agency_id='2eaaaaaa-0000-4000-8000-000000000003'),false,'... e continua na reconciliação');
select is((select count(*)::int from private.billing_audit_log where action='billing.synthetic_marked' and agency_id='2eaaaaaa-0000-4000-8000-000000000002'),1,'A marcação ficou na auditoria financeira');
select is((select count(*)::int from private.billing_audit_log where action='billing.synthetic_unmarked' and agency_id='2eaaaaaa-0000-4000-8000-000000000002'),1,'A desmarcação também');
select is((select metadata ->> 'reason' from private.billing_audit_log where action='billing.synthetic_marked' order by id desc limit 1),'Fictícia de teste sem contrapartida no Asaas','O motivo foi registrado');
select throws_ok($$update private.billing_audit_log set action='x' where action='billing.synthetic_marked'$$,null,null,'A auditoria continua imutável');
select public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000002'::uuid,true,'Fictícia para o relatório de verificação');
select is(jsonb_array_length(public.billing_synthetic_report()),1,'O relatório lista exatamente as organizações marcadas');
select is(public.billing_synthetic_report() -> 0 ->> 'marked_reason','Fictícia para o relatório de verificação','... com o motivo e os identificadores');
select is(public.billing_mark_synthetic('2eaaaaaa-0000-4000-8000-000000000002'::uuid,true,'Segunda marcação idempotente sem efeito'),0,'Marcar de novo não altera nem duplica a auditoria');
select ok(not has_function_privilege('authenticated','public.billing_synthetic_report()','execute') and has_function_privilege('service_role','public.billing_synthetic_report()','execute'),'Relatório: só o servidor');

select * from finish();
rollback;
