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


insert into meta_daily_insights(agency_id,ad_account_id,insight_date,level,external_entity_id,parent_external_id,entity_name,spend,impressions,link_clicks,api_version,metadata) values
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','campaign','61','act_5100','Campanha A',100,1000,10,'v-test','{}'),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-30','campaign','62','act_5100','Campanha B',150,1500,15,'v-test','{}'),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','adset','71','61','Conjunto A',100,1000,10,'v-test','{"campaign_id":"61"}'),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','ad','81','71','Anúncio A',30,300,3,'v-test','{"campaign_id":"61","adset_id":"71"}'),
('aaaaaaaa-0000-4000-8000-000000000051','50000000-0000-4000-8000-000000000051','2026-09-29','ad','82','71','Anúncio B',70,700,7,'v-test','{"campaign_id":"61","adset_id":"71"}');
update meta_collection_runs set levels=array['account','campaign','adset','ad'];
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select is((get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81'])->'summary'->>'spend')::numeric,30::numeric,'Seleção de um anúncio usa somente seu investimento');
select is((get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81','campaign:62'])->'summary'->>'spend')::numeric,180::numeric,'Seleção mista soma entidades disjuntas');
select is(get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81'])->'summary'->>'reach',null::text,'Alcance não soma pessoas entre entidades');
select throws_ok($q$select get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['campaign:61','ad:81'])$q$,'22023',null,'Seleção sobreposta é recusada');
select throws_ok($q$select get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:999'])$q$,'42501',null,'Entidade fora do escopo não inventa zeros');
select is(jsonb_array_length(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[])),5,'Hierarquia contém campanha, conjunto e anúncios');
select throws_ok($q$select create_dashboard_report('11111111-0000-4000-8000-000000000051','2026-09-28','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81'],array['link_clicks'],'Parcial','{}')$q$,'22023',null,'Relatório recusa dias sem coleta');
insert into report_test_ids(first_version) select create_dashboard_report('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81'],array['link_clicks'],'Relatório de anúncio','{"name":"Gestor independente","details":"Contato"}');
update report_test_ids set report_id=(select report_id from report_versions where id=first_version);
select is((select numeric_value from report_metrics where report_version_id=(select first_version from report_test_ids) and metric_key='spend'),30::numeric,'Snapshot usa os mesmos números da seleção');
select is((select count(*) from report_metrics where report_version_id=(select first_version from report_test_ids)),7::bigint,'Seis métricas fixas e a opcional selecionada são congeladas');
select is(get_dashboard_report_document((select first_version from report_test_ids))->'configuration'->'header'->>'name','Gestor independente','Cabeçalho personalizado é congelado');
select is(get_dashboard_report_document((select first_version from report_test_ids))->>'clientId','11111111-0000-4000-8000-000000000051','PDF identifica o cliente do relatório');
select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000054',true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000054',true);
select throws_ok($q$select create_dashboard_report('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81'],array['link_clicks'],'Cliente','{}')$q$,'42501',null,'Cliente não salva relatórios');
select throws_ok($q$select get_dashboard_report_document((select first_version from report_test_ids))$q$,'42501',null,'Cliente não baixa rascunho');
select is((get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81'])->'summary'->>'spend')::numeric,30::numeric,'Cliente pode consultar seleção para PDF efêmero');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select publish_report_version('aaaaaaaa-0000-4000-8000-000000000051',(select first_version from report_test_ids));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000054',true);
select lives_ok($q$select get_dashboard_report_document((select first_version from report_test_ids))$q$,'Cliente baixa PDF publicado');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000055',true);
select throws_ok($q$select get_dashboard_report_document((select first_version from report_test_ids))$q$,'42501',null,'Outra organização não baixa o documento');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select archive_dashboard_report('11111111-0000-4000-8000-000000000051',(select report_id from report_test_ids));
select is((select count(*) from list_client_portal_reports('11111111-0000-4000-8000-000000000051')),0::bigint,'Exclusão retira o relatório do histórico visível');
select is((select count(*) from report_metrics where report_version_id=(select first_version from report_test_ids)),7::bigint,'Exclusão preserva métricas imutáveis');
select throws_ok($q$select get_dashboard_report_document((select first_version from report_test_ids))$q$,'42501',null,'PDF excluído deixa de estar acessível');
select throws_ok($q$select get_client_portal_report_metrics((select first_version from report_test_ids))$q$,'22023',null,'Endpoint antigo também recusa relatório excluído');
reset role;
insert into meta_dashboard_scopes(agency_id,client_id,scope_key,date_from,date_to,payload) values
('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051',md5('50000000-0000-4000-8000-000000000051|'),'2026-09-29','2026-09-30','{"summary":{"reach":12,"frequency":2},"metrics":[]}'),
('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051',md5('50000000-0000-4000-8000-000000000051|ad:81'),'2026-09-29','2026-09-30','{"summary":{"reach":7,"frequency":1.5},"metrics":[]}');
set local role authenticated;
select is((get_client_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[])->'summary'->>'reach')::numeric,12::numeric,'Alcance total utiliza o agregado exato da conta');
select is((get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:81'])->'summary'->>'reach')::numeric,7::numeric,'Alcance selecionado utiliza o agregado exato dos anúncios');
select is(get_campaign_scoped_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[],array['ad:82'])->'summary'->>'reach',null::text,'Agregado de outro anúncio não é reutilizado');
select throws_ok($q$update meta_dashboard_scopes set payload='{}'$q$,'42501',null,'Usuário não forja agregados retornados pela Meta');
select throws_ok($q$select private.client_analytics_base('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',null)$q$,'42501',null,'Modelo privado permanece inacessível diretamente');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000055',true);
select throws_ok($q$select get_client_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[])$q$,'42501',null,'Agregados exatos não ampliam acesso entre organizações');
reset role;
update meta_dashboard_scopes set payload=payload||'{"entityValues":{"50000000-0000-4000-8000-000000000051:ad:81":{"reach":7,"frequency":1.5}},"estimatedMetricKeys":["unique_clicks"]}'
  where scope_key=md5('50000000-0000-4000-8000-000000000051|');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select is((select (e->'values'->>'reach')::numeric from jsonb_array_elements(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[])) e where e->>'key'='ad:81'),7::numeric,'Linha da seleção recebe alcance do período exato do anúncio');
select is((get_client_analytics('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[])->'estimatedMetricKeys')->>0,'unique_clicks','Estimativas preservam identificação explícita');
select throws_ok($q$select private.analytics_hierarchy_base('11111111-0000-4000-8000-000000000051','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000051']::uuid[])$q$,'42501',null,'Agregados de entidades não liberam acesso direto ao modelo privado');
select * from finish();
rollback;
