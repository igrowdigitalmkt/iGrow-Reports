begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000041','meta-owner-a@example.test',now()),
('10000000-0000-4000-8000-000000000042','meta-editor-a@example.test',now()),
('10000000-0000-4000-8000-000000000043','meta-viewer-a@example.test',now()),
('10000000-0000-4000-8000-000000000044','meta-owner-b@example.test',now()),
('10000000-0000-4000-8000-000000000045','meta-client-a@example.test',now());

insert into agencies(id,name) values
('aaaaaaaa-0000-4000-8000-000000000041','Agência Meta A'),
('bbbbbbbb-0000-4000-8000-000000000042','Agência Meta B');

insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000041','owner'),
('aaaaaaaa-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000042','editor'),
('aaaaaaaa-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000043','viewer'),
('bbbbbbbb-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000044','owner');

insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000041','aaaaaaaa-0000-4000-8000-000000000041','Cliente Meta A'),
('11111111-0000-4000-8000-000000000042','aaaaaaaa-0000-4000-8000-000000000041','Cliente Meta A2'),
('22222222-0000-4000-8000-000000000043','bbbbbbbb-0000-4000-8000-000000000042','Cliente Meta B');

insert into integrations(
  id,agency_id,provider,connection_status,health_status,last_success_at
) values
('30000000-0000-4000-8000-000000000041','aaaaaaaa-0000-4000-8000-000000000041','meta','connected','healthy',now()),
('30000000-0000-4000-8000-000000000042','bbbbbbbb-0000-4000-8000-000000000042','meta','connected','healthy',now());

insert into meta_connections(
  id,agency_id,integration_id,external_user_id,scopes,connected_at,client_id
) values
('40000000-0000-4000-8000-000000000041','aaaaaaaa-0000-4000-8000-000000000041','30000000-0000-4000-8000-000000000041','meta-user-a',array['ads_read'],now(),'11111111-0000-4000-8000-000000000041'),
('40000000-0000-4000-8000-000000000042','bbbbbbbb-0000-4000-8000-000000000042','30000000-0000-4000-8000-000000000042','meta-user-b',array['ads_read'],now(),'22222222-0000-4000-8000-000000000043');

insert into meta_ad_accounts(
  id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,account_status,last_synced_at
) values
('50000000-0000-4000-8000-000000000041','aaaaaaaa-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000041','act_1001','Conta BRL','BRL','America/Sao_Paulo','ACTIVE',now()),
('50000000-0000-4000-8000-000000000042','aaaaaaaa-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000041','act_1002','Conta USD','USD','America/Sao_Paulo','ACTIVE',now()),
('50000000-0000-4000-8000-000000000043','bbbbbbbb-0000-4000-8000-000000000042','40000000-0000-4000-8000-000000000042','act_2001','Conta B','BRL','America/Sao_Paulo','ACTIVE',now());

insert into meta_daily_insights(
  agency_id,ad_account_id,insight_date,level,external_entity_id,
  entity_name,spend,impressions,reach,link_clicks,api_version
) values
('aaaaaaaa-0000-4000-8000-000000000041','50000000-0000-4000-8000-000000000041','2026-09-29','account','act_1001','Conta BRL',100,10000,8000,100,'v-test'),
('aaaaaaaa-0000-4000-8000-000000000041','50000000-0000-4000-8000-000000000041','2026-09-30','account','act_1001','Conta BRL',150,15000,11000,150,'v-test');

insert into meta_daily_actions(
  agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value,value_amount
) values
('aaaaaaaa-0000-4000-8000-000000000041','50000000-0000-4000-8000-000000000041','2026-09-29','account','act_1001','lead',10,null),
('aaaaaaaa-0000-4000-8000-000000000041','50000000-0000-4000-8000-000000000041','2026-09-30','account','act_1001','lead',15,null),
('aaaaaaaa-0000-4000-8000-000000000041','50000000-0000-4000-8000-000000000041','2026-09-29','account','act_1001','omni_purchase',2,400),
('aaaaaaaa-0000-4000-8000-000000000041','50000000-0000-4000-8000-000000000041','2026-09-30','account','act_1001','omni_purchase',3,600);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000041',true);

select is((select count(*) from integrations),1::bigint,'Owner lê somente integrações da própria agência');
select is((select count(*) from meta_ad_accounts),2::bigint,'Owner lê somente contas Meta da própria agência');
select is((select count(*) from meta_daily_insights),2::bigint,'Owner lê insights da própria agência');
select throws_ok(
  $$insert into integrations(agency_id,provider) values('aaaaaaaa-0000-4000-8000-000000000041','whatsapp')$$,
  '42501',null,'Browser autenticado não forja integração operacional'
);
select throws_ok(
  $$insert into meta_daily_insights(
    agency_id,ad_account_id,insight_date,level,external_entity_id,spend,impressions,api_version
  ) values(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '50000000-0000-4000-8000-000000000041',
    '2026-10-01','account','act_1001',1,1,'v-test'
  )$$,
  '42501',null,'Browser autenticado não grava coleta Meta'
);

select lives_ok(
  $$select set_client_ad_account(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    '50000000-0000-4000-8000-000000000041',
    true
  )$$,
  'Owner associa conta Meta ao cliente'
);
select lives_ok(
  $$select set_client_metric_mapping(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    'leads','lead','omni_purchase'
  )$$,
  'Owner configura resultado principal'
);

select is(
  (select data_status from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  'ok',
  'Resumo fica disponível quando há dados compatíveis'
);
select is(
  (select spend from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  250::numeric,
  'Investimento é agregado pelos totais'
);
select is(
  (select impressions from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  25000::bigint,
  'Impressões são agregadas pelos totais'
);
select is(
  (select primary_results from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  25::numeric,
  'Resultado principal usa apenas a ação mapeada'
);
select is(
  round((select ctr_link from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),2),
  1.00::numeric,
  'CTR é recalculado pelos totais'
);
select is(
  round((select cost_per_result from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),2),
  10.00::numeric,
  'Custo por resultado usa investimento e resultado do mesmo escopo'
);
select is(
  round((select roas from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),2),
  4.00::numeric,
  'ROAS usa receita atribuída e investimento do mesmo escopo'
);
select throws_ok(
  $$select set_client_ad_account(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    '50000000-0000-4000-8000-000000000043',
    true
  )$$,
  '22023',null,'Conta de outra agência não pode ser associada'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000042',true);
select lives_ok(
  $$select set_client_ad_account(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    '50000000-0000-4000-8000-000000000042',
    true
  )$$,
  'Editor pode associar conta do próprio cliente'
);
select is(
  (select data_status from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  'incompatible',
  'Múltiplas moedas bloqueiam consolidação'
);
select is(
  (select compatibility_issue from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  'multiple_currencies',
  'Motivo da incompatibilidade é explícito'
);
select is(
  (select spend from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  null::numeric,
  'Consolidação incompatível não inventa investimento'
);
select lives_ok(
  $$select set_client_ad_account(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    '50000000-0000-4000-8000-000000000042',
    false
  )$$,
  'Editor pode desassociar conta'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000043',true);
select throws_ok(
  $$select set_client_ad_account(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    '50000000-0000-4000-8000-000000000041',
    false
  )$$,
  '42501',null,'Leitor não altera associação de conta'
);
select throws_ok(
  $$select set_client_metric_mapping(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    'leads','lead',null
  )$$,
  '42501',null,'Leitor não altera mapeamento de resultado'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000041',true);
select lives_ok(
  $$select set_client_user_access(
    'aaaaaaaa-0000-4000-8000-000000000041',
    '11111111-0000-4000-8000-000000000041',
    '10000000-0000-4000-8000-000000000045',
    true
  )$$,
  'Owner libera cliente para homologar resumo do portal'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000045',true);
select is((select count(*) from integrations),0::bigint,'Cliente não lê integrações da agência');
select is((select count(*) from meta_ad_accounts),0::bigint,'Cliente não lê contas Meta administrativas');
select is((select count(*) from meta_daily_insights),0::bigint,'Cliente não lê insights brutos');
select is(
  (select spend from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )),
  250::numeric,
  'Cliente acessa somente resumo agregado do vínculo autorizado'
);
select throws_ok(
  $$select * from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000042','2026-09-29','2026-09-30'
  )$$,
  '42501',null,'Cliente não consulta métricas de outro cliente'
);
select throws_ok(
  $$select * from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2025-01-01','2026-09-30'
  )$$,
  '22023',null,'Resumo limita períodos excessivos'
);
select throws_ok(
  $$insert into metric_definitions(
    key,label,description,unit,source,aggregation,desirable_direction,display_precision
  ) values('forged','Forjada','Forjada','integer','x','sum','up',0)$$,
  '42501',null,'Cliente não altera definições globais de métricas'
);

set local role anon;
select throws_ok($$select * from metric_definitions$$,'42501',null,'Visitante não lê definições de métricas');
select throws_ok(
  $$select * from get_client_portal_metric_summary(
    '11111111-0000-4000-8000-000000000041','2026-09-29','2026-09-30'
  )$$,
  '42501',null,'Visitante não consulta resumo do cliente'
);

reset role;
select * from finish();
rollback;
