begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000051','report-owner-a@example.test',now()),
('10000000-0000-4000-8000-000000000052','report-editor-a@example.test',now()),
('10000000-0000-4000-8000-000000000053','report-viewer-a@example.test',now()),
('10000000-0000-4000-8000-000000000054','report-client-a@example.test',now()),
('10000000-0000-4000-8000-000000000055','report-owner-b@example.test',now());

insert into agencies(id,name) values
('aaaaaaaa-0000-4000-8000-000000000051','Agência Reports A'),
('bbbbbbbb-0000-4000-8000-000000000052','Agência Reports B');

insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051','owner'),
('aaaaaaaa-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000052','editor'),
('aaaaaaaa-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000053','viewer'),
('bbbbbbbb-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000055','owner');

insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000051','aaaaaaaa-0000-4000-8000-000000000051','Cliente Reports A'),
('22222222-0000-4000-8000-000000000052','bbbbbbbb-0000-4000-8000-000000000052','Cliente Reports B');

insert into integrations(id,agency_id,provider,connection_status,health_status) values
('30000000-0000-4000-8000-000000000051','aaaaaaaa-0000-4000-8000-000000000051','meta','connected','healthy');
insert into meta_connections(id,agency_id,integration_id,client_id) values
('40000000-0000-4000-8000-000000000051','aaaaaaaa-0000-4000-8000-000000000051','30000000-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051');
insert into meta_ad_accounts(
  id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id
) values(
  '50000000-0000-4000-8000-000000000051',
  'aaaaaaaa-0000-4000-8000-000000000051',
  '40000000-0000-4000-8000-000000000051',
  'act_5100','Conta relatório','BRL','America/Sao_Paulo','100'
);
insert into client_ad_accounts(agency_id,client_id,ad_account_id,active) values(
  'aaaaaaaa-0000-4000-8000-000000000051',
  '11111111-0000-4000-8000-000000000051',
  '50000000-0000-4000-8000-000000000051',true
);
insert into client_metric_mappings(
  agency_id,client_id,primary_metric_key,primary_action_type,revenue_action_type
) values(
  'aaaaaaaa-0000-4000-8000-000000000051',
  '11111111-0000-4000-8000-000000000051',
  'leads','lead','omni_purchase'
);
insert into meta_daily_insights(
  agency_id,ad_account_id,insight_date,level,external_entity_id,
  entity_name,spend,impressions,link_clicks,api_version,collected_at
) values
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','account','act_5100','Conta relatório',100,10000,100,'v-test','2026-09-30T10:00:00Z'),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-30','account','act_5100','Conta relatório',150,15000,150,'v-test','2026-10-01T10:00:00Z');
insert into meta_daily_actions(
  agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value,value_amount
) values
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','account','act_5100','lead',10,null),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-30','account','act_5100','lead',15,null),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','account','act_5100','omni_purchase',2,400),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-30','account','act_5100','omni_purchase',3,600);

create temporary table report_test_ids(
  first_version uuid,
  report_id uuid,
  second_version uuid
);
grant all on report_test_ids to authenticated;

insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id)
values('50000000-0000-4000-8000-000000000052','aaaaaaaa-0000-4000-8000-000000000051','40000000-0000-4000-8000-000000000051','act_5200','Conta Los Angeles','BRL','America/Los_Angeles','100');
insert into client_ad_accounts(agency_id,client_id,ad_account_id,active)
values('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000052',true);

insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,levels) values
('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','2026-09-30','complete',2,array['account','campaign']),
('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000052','2026-09-29','2026-09-30','complete',0,array['account','campaign']);

insert into meta_dashboard_scopes(agency_id,client_id,scope_key,date_from,date_to,payload) values
('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051',
 md5('50000000-0000-4000-8000-000000000051,50000000-0000-4000-8000-000000000052|'),'2026-09-29','2026-09-30',
 '{"version":10,"summary":{"spend":250,"impressions":25000,"link_clicks":250,"ctr_link":1,"cpc_link":1,"cpm":10,"attributed_revenue":1000,"roas":4,"result:provider_known":1,"result:provider:action:lead":25},"previousSummary":{},"metrics":[],"accountValues":{"50000000-0000-4000-8000-000000000051":{"spend":250},"50000000-0000-4000-8000-000000000052":{"spend":0}},"entityCatalog":[]}');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);

select is((select data_status from get_client_portal_metric_summary('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30')), 'ok', 'Fusos diferentes permitem relatório por datas locais');
select is((select compatibility_issue from get_client_portal_metric_summary('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30')), 'multiple_timezones', 'Aviso de fuso usa os metadados reais das contas');
select is((select data_status from get_client_portal_metric_summary('11111111-0000-4000-8000-000000000051','2026-08-01','2026-08-02')), 'no_data', 'Ausência de dados não é tratada como bloqueio por fuso');
select is((select data_status from get_client_portal_metric_summary('11111111-0000-4000-8000-000000000051','2026-09-28','2026-09-30')), 'partial', 'Resumo não chama período parcialmente coletado de completo');
select throws_ok($$select create_manual_report_version('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','2026-09-28','2026-09-30',null,'Dados parciais')$$,'22023',null,'RPC rejeita relatório com um dia ainda sem cobertura');

insert into report_test_ids(first_version)
select create_manual_report_version(
  'aaaaaaaa-0000-4000-8000-000000000051',
  '11111111-0000-4000-8000-000000000051',
  '2026-09-29','2026-09-30',null,'Relatório setembro'
);
update report_test_ids x set report_id = (
  select rv.report_id from report_versions rv where rv.id = x.first_version
);

select is(
  (select state from report_versions where id=(select first_version from report_test_ids)),
  'ready','Nova versão nasce pronta, não publicada'
);
select is(
  (select numeric_value from report_metrics
   where report_version_id=(select first_version from report_test_ids)
     and metric_key='spend'),
  250::numeric,'Snapshot congela investimento'
);
select is(
  (select numeric_value from report_metrics
   where report_version_id=(select first_version from report_test_ids)
     and metric_key='primary_results'),
  25::numeric,'Snapshot congela somente o resultado nativo confirmado'
);
select is(
  (select (summary_json->>'roas')::numeric from report_data_snapshots
   where report_version_id=(select first_version from report_test_ids)),
  4::numeric,'Snapshot preserva ROAS calculado'
);
select ok(
  exists(select 1 from audit_logs where action='report.version_created'
    and entity_id=(select first_version from report_test_ids)),
  'Geração é auditada'
);

select lives_ok(
  $$select set_client_user_access(
    'aaaaaaaa-0000-4000-8000-000000000051',
    '11111111-0000-4000-8000-000000000051',
    '10000000-0000-4000-8000-000000000054',true
  )$$,
  'Owner libera cliente para consultar histórico'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000054',true);
select is(
  (select count(*) from list_client_portal_reports('11111111-0000-4000-8000-000000000051')),
  0::bigint,'Versão pronta não aparece para o cliente antes da publicação'
);
select is((select count(*) from report_versions),0::bigint,'Cliente não lê tabela interna de versões');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select lives_ok(
  format(
    'select publish_report_version(%L::uuid,%L::uuid)',
    'aaaaaaaa-0000-4000-8000-000000000051',
    (select first_version from report_test_ids)::text
  ),
  'Owner publica versão explicitamente'
);
select is(
  (select state from report_versions where id=(select first_version from report_test_ids)),
  'published','Versão passa a publicada'
);
select ok(
  (select published_at is not null from report_versions
   where id=(select first_version from report_test_ids)),
  'Publicação registra instante'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000054',true);
select is(
  (select count(*) from list_client_portal_reports('11111111-0000-4000-8000-000000000051')),
  1::bigint,'Cliente vê versão publicada pelo RPC seguro'
);
select is(
  (select numeric_value from get_client_portal_report_metrics(
    (select first_version from report_test_ids)
  ) where metric_key='spend'),
  250::numeric,'Cliente lê métricas congeladas sem consulta à Meta'
);
select is((select count(*) from meta_daily_insights),0::bigint,'Cliente continua sem ler Insights brutos');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000052',true);
select throws_ok($q$select create_manual_report_version('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',null,'Editor')$q$,'42501',null,'Editor não salva relatórios');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
update report_test_ids x set second_version = create_manual_report_version(
  'aaaaaaaa-0000-4000-8000-000000000051',
  '11111111-0000-4000-8000-000000000051',
  '2026-09-29','2026-09-30',x.report_id,'Relatório setembro'
);
select is(
  (select version_number from report_versions where id=(select second_version from report_test_ids)),
  2,'Administrador cria nova versão do mesmo relatório'
);
select lives_ok(
  format(
    'select publish_report_version(%L::uuid,%L::uuid)',
    'aaaaaaaa-0000-4000-8000-000000000051',
    (select second_version from report_test_ids)::text
  ),
  'Administrador publica nova versão'
);
select is(
  (select state from report_versions where id=(select first_version from report_test_ids)),
  'superseded','Versão anterior publicada é marcada como substituída'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000054',true);
select is(
  (select count(*) from list_client_portal_reports('11111111-0000-4000-8000-000000000051')),
  2::bigint,'Histórico preserva versão substituída e versão atual'
);
select is(
  (select numeric_value from get_client_portal_report_metrics(
    (select first_version from report_test_ids)
  ) where metric_key='spend'),
  250::numeric,'Versão substituída continua acessível e imutável'
);

reset role;
select throws_ok(
  format(
    'update public.report_metrics set numeric_value=999 where report_version_id=%L::uuid and metric_key=''spend''',
    (select first_version from report_test_ids)::text
  ),
  '42501',null,'Métricas de snapshot não podem ser alteradas'
);
select throws_ok(
  format(
    'update public.report_versions set date_from=''2026-09-28'' where id=%L::uuid',
    (select first_version from report_test_ids)::text
  ),
  '42501',null,'Versão publicada não permite alterar o período congelado'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000053',true);
select throws_ok(
  $$select create_manual_report_version(
    'aaaaaaaa-0000-4000-8000-000000000051',
    '11111111-0000-4000-8000-000000000051',
    '2026-09-29','2026-09-30',null,'Leitor não pode'
  )$$,
  '42501',null,'Leitor não gera relatório'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000055',true);
select throws_ok(
  $$select * from list_client_portal_reports('11111111-0000-4000-8000-000000000051')$$,
  '42501',null,'Outra agência não acessa histórico do cliente'
);

set local role anon;
select throws_ok(
  $$select * from list_client_portal_reports('11111111-0000-4000-8000-000000000051')$$,
  '42501',null,'Visitante não acessa histórico'
);

reset role;
select * from finish();
rollback;
