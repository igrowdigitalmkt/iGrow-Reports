begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000061','analytics-owner@example.test',now()),
('10000000-0000-4000-8000-000000000062','analytics-client@example.test',now()),
('10000000-0000-4000-8000-000000000063','analytics-other@example.test',now());
insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000061','Analytics A');
insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000061','owner');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','Analytics Cliente'),
('11111111-0000-4000-8000-000000000062','aaaaaaaa-0000-4000-8000-000000000061','Outro Cliente');
insert into client_users(agency_id,client_id,user_id,active) values
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000062',true);
insert into integrations(id,agency_id,provider,connection_status) values
('30000000-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','meta','connected');
insert into meta_connections(id,agency_id,integration_id,client_id) values
('40000000-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','30000000-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061'),
('40000000-0000-4000-8000-000000000062','aaaaaaaa-0000-4000-8000-000000000061','30000000-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000062');
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id,archived_at) values
('50000000-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000061','act_6101','Conta BRL','BRL','America/Sao_Paulo','100',null),
('50000000-0000-4000-8000-000000000062','aaaaaaaa-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000061','act_6102','Conta USD','USD','America/New_York','100',null),
('50000000-0000-4000-8000-000000000063','aaaaaaaa-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000062','act_6103','Conta de outro cliente','BRL','America/Sao_Paulo','100',null),
('50000000-0000-4000-8000-000000000064','aaaaaaaa-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000061','act_6104','Conta arquivada','BRL','America/Sao_Paulo',null,now());
insert into client_ad_accounts(agency_id,client_id,ad_account_id,active) values
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',true),
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000062',false),
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000063',true),
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000064',true);
insert into client_metric_mappings(agency_id,client_id,primary_metric_key,primary_action_type,revenue_action_type) values
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','leads','lead','omni_purchase');
insert into meta_daily_insights(agency_id,ad_account_id,insight_date,level,external_entity_id,entity_name,spend,impressions,reach,link_clicks,api_version,metadata) values
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-29','account','act_6101','Conta BRL',100,10000,9000,50,'v26.0','{"clicks":70}'),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-30','account','act_6101','Conta BRL',200,10000,9500,50,'v26.0','{"clicks":80}'),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-26','account','act_6101','Conta BRL',50,1000,900,10,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-29','campaign','campaign61','Campanha real',100,10000,9000,50,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-30','campaign','campaign61','Campanha real',200,10000,9500,50,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-30','ad','ad61','Anúncio real',999,999,999,999,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000063','2026-09-30','account','act_6103','Outra conta',9999,9999,9999,9999,'v26.0','{}');
insert into meta_daily_actions(agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value,value_amount) values
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-29','account','act_6101','lead',10,null),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-30','account','act_6101','lead',20,null),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-29','account','act_6101','landing_page_view',70,null),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-30','account','act_6101','landing_page_view',60,null),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-30','account','act_6101','omni_purchase',3,1200),
('aaaaaaaa-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-30','campaign','campaign61','lead',20,null);
insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,levels) values
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-28','2026-09-30','complete',4,array['account','campaign']),
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-25','2026-09-27','complete',1,array['account','campaign']);
insert into meta_period_insights(agency_id,client_id,ad_account_id,date_from,date_to,reach,frequency,unique_clicks,api_version) values
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061','2026-09-28','2026-09-30',12000,1.6667,85,'v26.0');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000061',true);
create temporary table analytics_payload as select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30') as data;
select is((select jsonb_array_length(data->'accounts') from analytics_payload),1,'Escopo exclui contas inativas, arquivadas e da conexão de outro cliente');
select is((select (data->'summary'->>'spend')::numeric from analytics_payload),300::numeric,'Totais usam somente account, sem duplicar campaign e ad');
select is((select (data->'summary'->>'impressions')::numeric from analytics_payload),20000::numeric,'Impressões respeitam o mesmo escopo da conta');
select is((select (data->'summary'->>'primary_results')::numeric from analytics_payload),30::numeric,'Resultados usam exclusivamente o evento principal configurado');
select is((select (data->'summary'->>'action:landing_page_view')::numeric from analytics_payload),130::numeric,'Ações adicionais são descobertas dinamicamente');
select is((select (data->'summary'->>'clicks')::numeric from analytics_payload),150::numeric,'Campos escalares adicionais preservam dados coletados');
select is((select (data->'summary'->>'cpc_link')::numeric from analytics_payload),3::numeric,'CPC usa totais e não média das razões diárias');
select is((select (data->'summary'->>'ctr_link')::numeric from analytics_payload),0.5::numeric,'CTR é recalculado com cliques e impressões');
select is((select (data->'summary'->>'roas')::numeric from analytics_payload),4::numeric,'ROAS usa receita explicitamente retornada');
select is((select (data->'summary'->>'reach')::numeric from analytics_payload),12000::numeric,'Alcance usa consulta do período exato, nunca soma diária');
select is((select (data->'summary'->>'unique_clicks')::numeric from analytics_payload),85::numeric,'Cliques únicos vêm da consulta agregada exata');
select is((select data->'coverage'->>'status' from analytics_payload),'complete','Coleta concluída prova cobertura de dias sem atividade');
select is((select (data->'coverage'->>'coveredDays')::integer from analytics_payload),3,'Cobertura contabiliza cada dia em todas as contas selecionadas');
select is((select jsonb_array_length(data->'daily') from analytics_payload),3,'Série inclui zero somente para dia coberto por coleta concluída');
select is((select (data->'daily'->0->'values'->>'spend')::numeric from analytics_payload),0::numeric,'Dia sem atividade confirmado pela Meta tem investimento zero');
select is((select data->>'previousDateFrom' from analytics_payload),'2026-09-25','Comparação tem duração igual imediatamente anterior');
select is((select (data->'previousSummary'->>'spend')::numeric from analytics_payload),50::numeric,'Dados anteriores preservam período separado');
select is((select (data->'campaigns'->0->'values'->>'spend')::numeric from analytics_payload),300::numeric,'Tabela de campanhas usa exclusivamente granularidade campaign');
select is((select data->'summary'->>'inline_post_engagement' from analytics_payload),null::text,'Campo não coletado permanece indisponível');
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2025-01-01','2026-09-30')$$,'22023',null,'Período excessivo é rejeitado');
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-30','2026-09-29')$$,'22023',null,'Datas invertidas são rejeitadas');
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30',array['50000000-0000-4000-8000-000000000063']::uuid[])$$,'42501',null,'Filtro não aceita conta da conexão de outro cliente');
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30',array[null]::uuid[])$$,'42501',null,'Filtro não aceita identidade nula');
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-10-01','2026-10-02')->'summary'->>'spend'),null::text,'Período sem coleta não inventa valores');
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-29','2026-09-30')->'summary'->>'reach'),null::text,'Outro intervalo não reutiliza alcance de período incompatível');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000062',true);
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')->'summary'->>'spend')::numeric,300::numeric,'Cliente recebe o mesmo dashboard agregado de seu vínculo');
select is((select count(*) from meta_daily_insights),0::bigint,'Cliente continua sem acesso irrestrito aos dados brutos');
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000062','2026-09-28','2026-09-30')$$,'42501',null,'Cliente não lê analytics de outro cliente');
select throws_ok($$select private.analytics_values('[]',null,null,null,array[]::text[],true,true)$$,'42501',null,'Cliente não chama helper interno sem autorização');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000063',true);
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')$$,'42501',null,'Usuário sem vínculo não acessa dashboard');

reset role;
update client_ad_accounts set active=true where ad_account_id='50000000-0000-4000-8000-000000000062';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000061',true);
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')->'summary'->>'spend'),null::text,'Moedas diferentes não produzem investimento consolidado enganoso');
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')->'summary'->>'cpc_link'),null::text,'Razões monetárias de moedas diferentes não são calculadas');
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')->'summary'->>'reach'),null::text,'Alcance não soma usuários entre contas');
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')->'coverage'->>'status'),'partial','Uma segunda conta sem cobertura torna o período parcial');
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30',array['50000000-0000-4000-8000-000000000061']::uuid[])->'summary'->>'spend')::numeric,300::numeric,'Filtro de conta restaura moeda e totais corretos');
reset role;
update meta_ad_accounts set currency='BRL' where id='50000000-0000-4000-8000-000000000062';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000061',true);
select is((get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')->'summary'->>'spend')::numeric,300::numeric,'Fusos diferentes são informativos e não bloqueiam investimento');

reset role;
update client_users set active=false where user_id='10000000-0000-4000-8000-000000000062';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000062',true);
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')$$,'42501',null,'Revogação remove acesso ao dashboard na próxima consulta');
set local role anon;
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')$$,'42501',null,'Visitante não executa RPC de analytics');
set local role service_role;
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000061','2026-09-28','2026-09-30')$$,'42501',null,'Read model público exige sessão autorizada, não service_role');
reset role;
select * from finish();
rollback;
