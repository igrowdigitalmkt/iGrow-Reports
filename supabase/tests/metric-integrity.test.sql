begin;
set local search_path=public,extensions;
select no_plan();

select is((private.analytics_values('[{"spend":393.87,"actions":{"onsite_conversion.messaging_conversation_started_7d":11},"instagram_profile_visits":51,"provider_results":{"result:provider_known":1,"result:provider:action:onsite_conversion.messaging_conversation_started_7d":11}}]',null,null,null,array['onsite_conversion.messaging_conversation_started_7d'],true,true,null)->>'primary_results')::numeric,11::numeric,'Resultados diÃ¡rios preservam a escolha nativa sem somar visitas secundÃ¡rias');
select is(round((private.analytics_values('[{"spend":393.87,"provider_results":{"result:provider_known":1,"result:provider:action:onsite_conversion.messaging_conversation_started_7d":11}}]',null,null,null,array[]::text[],true,true,null)->>'cost_per_result')::numeric,2),35.81::numeric,'Custo por resultado divide pelo resultado escolhido pela Meta');
select is(private.analytics_values('[{"spend":10,"provider_results":{"result:provider_known":1,"result:provider:action:lead":2}},{"spend":20,"actions":{"lead":3}}]',null,null,null,array['lead'],true,true,null)->>'primary_results',null::text,'Uma entidade desconhecida impede total nativo parcial');
select is(private.analytics_values('[{"spend":10,"actions":{"lead":2}},{"spend":20}]',null,null,null,array['lead'],true,true,null)->>'action:lead',null::text,'AÃ§Ã£o ausente sem confirmaÃ§Ã£o nÃ£o Ã© somada como zero');
select is((private.analytics_values('[{"spend":10,"actions":{"lead":2},"actions_confirmed":true},{"spend":20,"actions":{},"actions_confirmed":true}]',null,null,null,array['lead'],true,true,null)->>'action:lead')::numeric,2::numeric,'Lista de aÃ§Ãµes explicitamente vazia confirma zero');
select is(private.analytics_values('[{"spend":0,"impressions":0,"analytics_version":11,"canonical_values":{"spend":null,"impressions":null}}]',null,null,null,array[]::text[],true,true,null)->>'spend',null::text,'Valor canÃ´nico ausente prevalece sobre zero exigido por coluna histÃ³rica');
select is(private.result_values('{"spend":100,"result:provider_known":1,"result:provider:action:lead":10,"result:provider:profile_visit_view":20}',true)->>'primary_results',null::text,'Resultados de famÃ­lias diferentes nÃ£o formam total combinado');
select is(private.result_values('{"spend":100,"result:provider_known":1,"result:provider:action:lead":10,"result:provider:profile_visit_view":20}',true)->>'cost_per_result',null::text,'FamÃ­lias diferentes nÃ£o formam custo mÃ©dio combinado');
select is((private.result_values('{"result:provider_known":1,"result:provider:action:lead":10,"result:provider:action:omni_lead":20}',true)->>'primary_results')::numeric,30::numeric,'Aliases nativos da mesma famÃ­lia em entidades distintas mantÃªm total');

insert into auth.users(id,email,email_confirmed_at) values('10000000-0000-4000-8000-000000000071','integrity-owner@example.test',now());
insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000071','Integridade');
insert into agency_users(agency_id,user_id,role) values('aaaaaaaa-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000071','owner');
insert into clients(id,agency_id,name) values('11111111-0000-4000-8000-000000000071','aaaaaaaa-0000-4000-8000-000000000071','Cliente integridade');
insert into integrations(id,agency_id,provider,connection_status,health_status) values('30000000-0000-4000-8000-000000000071','aaaaaaaa-0000-4000-8000-000000000071','meta','connected','healthy');
insert into meta_connections(id,agency_id,integration_id,client_id) values('40000000-0000-4000-8000-000000000071','aaaaaaaa-0000-4000-8000-000000000071','30000000-0000-4000-8000-000000000071','11111111-0000-4000-8000-000000000071');
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id) values('50000000-0000-4000-8000-000000000071','aaaaaaaa-0000-4000-8000-000000000071','40000000-0000-4000-8000-000000000071','act_71','Conta integridade','BRL','America/Sao_Paulo','100');
insert into client_ad_accounts(agency_id,client_id,ad_account_id,active) values('aaaaaaaa-0000-4000-8000-000000000071','11111111-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071',true);
insert into meta_daily_insights(agency_id,ad_account_id,insight_date,level,external_entity_id,parent_external_id,entity_name,spend,impressions,link_clicks,api_version,metadata) values
('aaaaaaaa-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071','2026-09-30','account','act_71',null,'Conta integridade',101,1000,10,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071','2026-09-30','campaign','710','act_71','Campanha histÃ³rica',101,1000,10,'v26.0','{"analytics_version":11,"actions_confirmed":true,"canonical_values":{"spend":101,"impressions":1000,"link_clicks":10,"action:onsite_conversion.messaging_conversation_started_7d":11,"instagram_profile_visits":51,"result:provider_known":1,"result:provider:action:onsite_conversion.messaging_conversation_started_7d":11}}'),
('aaaaaaaa-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071','2026-09-30','adset','711','710','Conjunto antigo',101,1000,10,'v26.0','{"campaign_id":"710"}'),
('aaaaaaaa-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071','2026-09-30','ad','712','711','AnÃºncio antigo',101,1000,10,'v26.0','{"campaign_id":"710","adset_id":"711"}');
insert into meta_daily_actions(agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value) values
('aaaaaaaa-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071','2026-09-30','campaign','710','onsite_conversion.messaging_conversation_started_7d',50);
insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,levels) values
('aaaaaaaa-0000-4000-8000-000000000071','11111111-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071','2026-09-29','2026-09-30','complete',2,array['account','campaign']);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000071',true);
select is((select e->'values'->>'primary_results' from jsonb_array_elements(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[])) e where e->>'key'='campaign:710'),'11','Linha diÃ¡ria lÃª resultados canÃ´nicos guardados pela coleta');
select is((select e->'values'->>'action:onsite_conversion.messaging_conversation_started_7d' from jsonb_array_elements(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[])) e where e->>'key'='campaign:710'),'11','AÃ§Ãµes canÃ´nicas substituem aÃ§Ãµes de contrato anterior');
select is((select e->'values' from jsonb_array_elements(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[])) e where e->>'key'='adset:711'),'{}'::jsonb,'Sem cobertura prÃ³pria conjuntos antigos permanecem desconhecidos');
select is((select e->'values' from jsonb_array_elements(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[])) e where e->>'key'='ad:712'),'{}'::jsonb,'Sem cobertura prÃ³pria anÃºncios antigos permanecem desconhecidos');
select throws_ok($q$select create_dashboard_report('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[],array[]::text[],array['link_clicks'],'Sem agregado','{}')$q$,'22023',null,'RelatÃ³rio nÃ£o congela dados sem agregado exato validado');
reset role;
insert into meta_dashboard_scopes(agency_id,client_id,scope_key,date_from,date_to,payload) values
('aaaaaaaa-0000-4000-8000-000000000071','11111111-0000-4000-8000-000000000071',md5('50000000-0000-4000-8000-000000000071|'),'2026-09-29','2026-09-30',
 '{"version":6,"summary":{"spend":9999,"primary_results":9999},"previousSummary":{},"metrics":[]}');
set local role authenticated;
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'metaAggregate'->>'confirmed','false','Cache anterior Ã  auditoria nÃ£o Ã© confirmado');
select is((get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'summary'->>'spend')::numeric,101::numeric,'Cache antigo nÃ£o contamina investimento');
reset role;
update meta_dashboard_scopes set collected_at=now()-interval '2 hours',payload=payload||'{"version":11}';
set local role authenticated;
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'metaAggregate'->>'confirmed','false','Cache com mais de uma hora nÃ£o Ã© confirmado');
reset role;
update meta_dashboard_scopes set collected_at=now(),payload=
 '{"version":11,"summary":{"spend":99,"result:provider_known":1,"result:provider:action:onsite_conversion.messaging_conversation_started_7d":11},"previousSummary":{},"metrics":[],"accountValues":{"50000000-0000-4000-8000-000000000071":{"spend":99}},"entityValues":{"50000000-0000-4000-8000-000000000071:campaign:710":{"spend":99,"reach":777,"action:onsite_conversion.messaging_conversation_started_7d":null,"primary_results":null}},"entityCatalog":[{"key":"campaign:710","id":"710","level":"campaign","accountId":"50000000-0000-4000-8000-000000000071","name":"Campanha exata","currency":"BRL"}]}';
set local role authenticated;
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'metaAggregate'->>'confirmed','true','Agregado atual do contrato correto Ã© confirmado');
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'summary'->>'primary_results','11','Resumo exato preserva resultado escolhido');
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'accountTotals'->0->'values'->>'spend','99','Investimento por conta usa o mesmo agregado exato');
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'campaigns'->0->'values'->>'spend','99','Tabela usa os mesmos valores exatos sem soma diÃ¡ria antiga');
select is((select e->'values'->>'reach' from jsonb_array_elements(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[])) e where e->>'key'='campaign:710'),'777','Alcance pertence ao mesmo perÃ­odo e Ã  mesma entidade');
select is((select e->'values'->>'action:onsite_conversion.messaging_conversation_started_7d' from jsonb_array_elements(get_client_analytics_hierarchy('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[])) e where e->>'key'='campaign:710'),null::text,'AÃ§Ã£o ausente exata nÃ£o ressuscita valor diÃ¡rio antigo');
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-30','2026-09-30')->'metaAggregate'->>'confirmed','false','Outro perÃ­odo nÃ£o reutiliza agregado incompatÃ­vel');
select throws_ok($q$select private.valid_dashboard_scope('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30',array['50000000-0000-4000-8000-000000000071']::uuid[],array[]::text[])$q$,'42501',null,'UsuÃ¡rio nÃ£o contorna a autorizaÃ§Ã£o para consultar cache diretamente');
reset role;
update meta_daily_insights set collected_at=now()+interval '1 second' where level='account';
set local role authenticated;
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'metaAggregate'->>'confirmed','false','Coleta diÃ¡ria posterior invalida o agregado antigo');
reset role;
update meta_daily_insights set collected_at=now();
update meta_collection_runs set collected_at=now()+interval '1 second';
set local role authenticated;
select is(get_client_analytics('11111111-0000-4000-8000-000000000071','2026-09-29','2026-09-30')->'metaAggregate'->>'confirmed','false','Lote completo posterior invalida agregado inclusive para resposta vazia');
reset role;
insert into reports(id,agency_id,client_id,title,created_by) values('60000000-0000-4000-8000-000000000071','aaaaaaaa-0000-4000-8000-000000000071','11111111-0000-4000-8000-000000000071','RelatÃ³rio histÃ³rico','10000000-0000-4000-8000-000000000071');
insert into report_versions(id,agency_id,report_id,client_id,version_number,date_from,date_to,currency,state,configuration_snapshot,created_by) values
('70000000-0000-4000-8000-000000000071','aaaaaaaa-0000-4000-8000-000000000071','60000000-0000-4000-8000-000000000071','11111111-0000-4000-8000-000000000071',1,'2026-09-29','2026-09-30','BRL','ready','{"snapshot_version":4}','10000000-0000-4000-8000-000000000071');
set local role authenticated;
select throws_ok($q$select publish_report_version('aaaaaaaa-0000-4000-8000-000000000071','70000000-0000-4000-8000-000000000071')$q$,'22023',null,'Snapshot antigo nÃ£o pode ser publicado como auditado');
select throws_ok($q$select get_dashboard_report_document('70000000-0000-4000-8000-000000000071')$q$,'22023',null,'Snapshot antigo nÃ£o Ã© apresentado como dado confirmado');
select is((select configuration_snapshot->>'snapshot_version' from report_versions where id='70000000-0000-4000-8000-000000000071'),'4','ProteÃ§Ã£o preserva fisicamente o histÃ³rico sem reescrever mÃ©tricas');
reset role;
select * from finish();
rollback;

