begin;
set local search_path=public,extensions;
select no_plan();

-- Fixtures (papel de banco). Os gatilhos de limite valem também para quem insere diretamente.
insert into auth.users(id,email,email_confirmed_at) values
('f0000000-0000-4000-8000-000000000001','operador@example.test',now()),
('f0000000-0000-4000-8000-000000000002','dono-a@example.test',now()),
('f0000000-0000-4000-8000-000000000003','dono-b@example.test',now()),
('f0000000-0000-4000-8000-000000000004','membro-a@example.test',now()),
('f0000000-0000-4000-8000-000000000005','extra-a@example.test',now());
insert into agencies(id,name) values
('faaaaaaa-0000-4000-8000-000000000001','Organização A'),
('faaaaaaa-0000-4000-8000-000000000002','Organização B');
insert into agency_users(agency_id,user_id,role) values
('faaaaaaa-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','owner'),
('faaaaaaa-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000003','owner');
insert into private.platform_operators(user_id,role) values ('f0000000-0000-4000-8000-000000000001','owner');

-- Estrutura e permissões
select ok(not has_table_privilege('authenticated','private.plans','select') and not has_table_privilege('anon','private.entitlement_overrides','select')
  and not has_table_privilege('service_role','private.plan_versions','select'),'Tabelas comerciais sem acesso direto pela API');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.plans'::regclass,'private.plan_versions'::regclass,'private.plan_version_entitlements'::regclass,'private.agency_plan_assignments'::regclass,'private.entitlement_overrides'::regclass,'private.entitlement_definitions'::regclass)),'RLS ligado nas tabelas comerciais');
select ok(not has_function_privilege('anon','public.platform_list_plans()','execute') and not has_function_privilege('service_role','public.platform_assign_plan(uuid,uuid,text)','execute')
  and has_function_privilege('authenticated','public.platform_list_plans()','execute'),'Funções administrativas: só usuários autenticados (e conferem o operador)');
select ok(has_function_privilege('service_role','public.agency_ai_entitlement(uuid)','execute') and not has_function_privilege('authenticated','public.agency_ai_entitlement(uuid)','execute'),'Direito da IA é só do servidor');
select is((select count(*)::int from private.agency_plan_assignments),0,'A migration não atribui plano a nenhuma organização');
select is((select count(*)::int from private.plans),0,'Nenhum plano fictício é criado');

-- Quem pode administrar
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select * from public.platform_list_plans()$$,'42501',null,'Proprietário de organização não administra planos');
select throws_ok($$select public.platform_create_plan('x1','Plano X','', 'public')$$,'42501',null,'Não operador não cria plano');
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($$select * from public.platform_list_plans()$$,'42501',null,'Operador sem MFA não administra planos');
select throws_ok($$select public.platform_set_feature_switch('client_portal',false,'teste')$$,'42501',null,'Operador sem MFA não liga interruptores');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);

-- Plano, rascunho, publicação e versionamento
select set_config('t.plan',public.platform_create_plan('basico','Básico','Plano de teste','public')::text,true);
select throws_ok($$select public.platform_create_plan('basico','Outro','', 'public')$$,'23505',null,'Identificador do plano é único');
select throws_ok($$select public.platform_create_plan('Inválido!','Outro','', 'public')$$,'23514',null,'Identificador inválido é recusado');
select throws_ok($$select public.platform_update_plan(current_setting('t.plan')::uuid,'Básico','','public',true,false,10)$$,'22023',null,'Não vende plano sem versão publicada com preço');
select lives_ok($$select public.platform_save_draft(current_setting('t.plan')::uuid,7,4990,49900,
  '[{"key":"clients","limit":3},{"key":"team_members","limit":2},{"key":"ad_accounts","limit":1},{"key":"whatsapp_numbers","limit":1},{"key":"report_automations","limit":1},{"key":"ai_assistant","enabled":true},{"key":"ai_budget_usd_cents","limit":500}]'::jsonb)$$,'Salva o rascunho da versão 1');
select throws_ok($$select public.platform_save_draft(current_setting('t.plan')::uuid,7,4990,null,'[{"key":"nao_existe","enabled":true}]'::jsonb)$$,'22023',null,'Recurso fora do catálogo é recusado (não cria capacidade nova)');
select throws_ok($$select public.platform_save_draft(current_setting('t.plan')::uuid,200,4990,null,'[]'::jsonb)$$,'23514',null,'Dias de teste fora da faixa são recusados');
select is(public.platform_publish_draft(current_setting('t.plan')::uuid),1,'Publica a versão 1');
select lives_ok($$select public.platform_update_plan(current_setting('t.plan')::uuid,'Básico','Descrição','public',true,true,10)$$,'Plano com versão publicada e preço pode ser vendido');
select throws_ok($$select public.platform_publish_draft(current_setting('t.plan')::uuid)$$,'22023',null,'Sem rascunho não há o que publicar');
select throws_ok($$select public.platform_save_draft(current_setting('t.plan')::uuid,0,100,null,'[]'::jsonb)$$,'22023',null,'Versão publicada não é editada: exige novo rascunho');
select set_config('t.v1',(public.platform_get_plan(current_setting('t.plan')::uuid) -> 'versions' -> 0 ->> 'id'),true);
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$update private.plan_versions set price_monthly_cents = 1 where id = current_setting('t.v1')::uuid$$,'42501',null,'Preço de versão publicada é imutável (nem pelo dono do banco)');
select throws_ok($$delete from private.plan_version_entitlements where plan_version_id = current_setting('t.v1')::uuid$$,'42501',null,'Recursos de versão publicada são imutáveis');
select throws_ok($$delete from private.plan_versions where id = current_setting('t.v1')::uuid$$,'42501',null,'Versão publicada não é apagada');
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_start_draft(current_setting('t.plan')::uuid)$$,'Cria a versão 2 (cópia da atual)');
select throws_ok($$select public.platform_start_draft(current_setting('t.plan')::uuid)$$,'23505',null,'Só um rascunho por plano');
select lives_ok($$select public.platform_save_draft(current_setting('t.plan')::uuid,14,5990,59900,
  '[{"key":"clients","limit":2},{"key":"team_members","limit":2},{"key":"ad_accounts","limit":1},{"key":"whatsapp_numbers","limit":1},{"key":"report_automations","limit":1},{"key":"ai_assistant","enabled":true},{"key":"ai_budget_usd_cents","limit":500}]'::jsonb)$$,'Edita a versão 2 sem tocar na 1');
select is(public.platform_publish_draft(current_setting('t.plan')::uuid),2,'Publica a versão 2');
select ok((select current_version_id is not null and current_version = 2 from public.platform_list_plans() where key = 'basico'),'Lista de planos informa a versão atual');
select is((public.platform_get_plan(current_setting('t.plan')::uuid) -> 'versions' -> 1 ->> 'status'),'retired','A versão anterior fica aposentada, com as condições originais');
select is((public.platform_get_plan(current_setting('t.plan')::uuid) -> 'versions' -> 1 ->> 'price_monthly_cents')::int,4990,'Preço da versão 1 preservado');
select set_config('t.v2',(public.platform_get_plan(current_setting('t.plan')::uuid) -> 'versions' -> 0 ->> 'id'),true);

-- Atribuição
select throws_ok($$select public.platform_assign_plan('faaaaaaa-0000-4000-8000-000000000001',current_setting('t.v1')::uuid,'motivo válido')$$,'22023',null,'Versão aposentada não pode ser atribuída');
select throws_ok($$select public.platform_assign_plan('faaaaaaa-0000-4000-8000-0000000000ff',current_setting('t.v2')::uuid,'motivo válido')$$,'22023',null,'Organização inexistente é recusada');
select throws_ok($$select public.platform_grant_override('faaaaaaa-0000-4000-8000-000000000001','clients',null,5,false,null,'teste de concessão')$$,'22023',null,'Concessão exige organização com plano atribuído');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Organização B (sem plano atribuído) continua sem nenhuma restrição
insert into clients(agency_id,name) select 'faaaaaaa-0000-4000-8000-000000000002','Cliente B'||g from generate_series(1,6) g;
select is((select count(*)::int from clients where agency_id='faaaaaaa-0000-4000-8000-000000000002'),6,'Organização sem plano atribuído: comportamento atual preservado');

-- Organização A recebe o plano (já com 3 clientes: acima do limite 2; nada é removido)
insert into clients(agency_id,name) select 'faaaaaaa-0000-4000-8000-000000000001','Cliente A'||g from generate_series(1,3) g;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is(jsonb_array_length(public.platform_assign_plan('faaaaaaa-0000-4000-8000-000000000001',current_setting('t.v2')::uuid,'plano de teste') -> 'over_limit'),1,'Atribuição informa o que já excede o limite');
reset role;
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::int from clients where agency_id='faaaaaaa-0000-4000-8000-000000000001'),3,'Nenhum cliente existente é removido ou arquivado');
select throws_ok($$insert into clients(agency_id,name) values ('faaaaaaa-0000-4000-8000-000000000001','Excedente')$$,'53400',null,'Limite de clientes recusa novo cliente');
update clients set archived_at = now() where agency_id='faaaaaaa-0000-4000-8000-000000000001' and name in ('Cliente A2','Cliente A3');
select lives_ok($$insert into clients(agency_id,name) values ('faaaaaaa-0000-4000-8000-000000000001','Cabe agora')$$,'Arquivar libera espaço para outro cliente');
select throws_ok($$update clients set archived_at = null where agency_id='faaaaaaa-0000-4000-8000-000000000001' and name = 'Cliente A2'$$,'53400',null,'Desarquivar também respeita o limite');
select lives_ok($$update clients set notes = 'editado' where agency_id='faaaaaaa-0000-4000-8000-000000000001' and name = 'Cliente A1'$$,'Editar um cliente existente nunca é bloqueado');

-- Equipe: membros e convites
insert into agency_users(agency_id,user_id,role) values ('faaaaaaa-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000004','editor');
select throws_ok($$insert into agency_users(agency_id,user_id,role) values ('faaaaaaa-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000005','viewer')$$,'53400',null,'Limite de usuários recusa novo membro');
select throws_ok($$insert into agency_invitations(agency_id,email,role,token_hash,expires_at) values ('faaaaaaa-0000-4000-8000-000000000001','novo@example.test','viewer',repeat('a',64),now()+interval '1 day')$$,'53400',null,'Limite de usuários também vale para convites');

-- Contas de anúncio: conta já vinculada a outro cliente não conta de novo
insert into integrations(id,agency_id,provider) values ('fbbbbbbb-0000-4000-8000-000000000001','faaaaaaa-0000-4000-8000-000000000001','meta'),
 ('fbbbbbbb-0000-4000-8000-000000000002','faaaaaaa-0000-4000-8000-000000000001','whatsapp');
insert into meta_connections(id,agency_id,integration_id) values ('fcccccc0-0000-4000-8000-000000000001','faaaaaaa-0000-4000-8000-000000000001','fbbbbbbb-0000-4000-8000-000000000001');
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id) values
 ('fdddddd0-0000-4000-8000-000000000001','faaaaaaa-0000-4000-8000-000000000001','fcccccc0-0000-4000-8000-000000000001','act_1','Conta 1','BRL','America/Sao_Paulo','123456'),
 ('fdddddd0-0000-4000-8000-000000000002','faaaaaaa-0000-4000-8000-000000000001','fcccccc0-0000-4000-8000-000000000001','act_2','Conta 2','BRL','America/Sao_Paulo','123456');
insert into client_ad_accounts(agency_id,client_id,ad_account_id) select 'faaaaaaa-0000-4000-8000-000000000001',id,'fdddddd0-0000-4000-8000-000000000001' from clients where name='Cliente A1';
select throws_ok($$insert into client_ad_accounts(agency_id,client_id,ad_account_id) select 'faaaaaaa-0000-4000-8000-000000000001',id,'fdddddd0-0000-4000-8000-000000000002' from clients where name='Cliente A1'$$,'53400',null,'Limite de contas de anúncio recusa nova conta');
select lives_ok($$insert into client_ad_accounts(agency_id,client_id,ad_account_id) select 'faaaaaaa-0000-4000-8000-000000000001',id,'fdddddd0-0000-4000-8000-000000000001' from clients where name='Cabe agora'$$,'A mesma conta em outro cliente não conta de novo');
select lives_ok($$insert into client_ad_accounts(agency_id,client_id,ad_account_id) select 'faaaaaaa-0000-4000-8000-000000000001',id,'fdddddd0-0000-4000-8000-000000000001' from clients where name='Cliente A1' on conflict (agency_id,client_id,ad_account_id) do update set active = true$$,'Regravar um vínculo já ativo não é bloqueado');

-- WhatsApp oficial
insert into whatsapp_connections(agency_id,integration_id,waba_id,phone_number_id) values ('faaaaaaa-0000-4000-8000-000000000001','fbbbbbbb-0000-4000-8000-000000000002','1111111111','2222222222');
select throws_ok($$insert into whatsapp_connections(agency_id,integration_id,waba_id,phone_number_id) values ('faaaaaaa-0000-4000-8000-000000000001','fbbbbbbb-0000-4000-8000-000000000002','1111111111','3333333333')$$,'53400',null,'Limite de números oficiais recusa um segundo número');
select lives_ok($$insert into whatsapp_connections(agency_id,integration_id,waba_id,phone_number_id) values ('faaaaaaa-0000-4000-8000-000000000001','fbbbbbbb-0000-4000-8000-000000000002','1111111111','2222222222') on conflict (phone_number_id) do update set updated_at = now()$$,'Regravar o mesmo número não é bloqueado');

-- Automações
insert into report_automations(agency_id,client_id,name,message_template) select 'faaaaaaa-0000-4000-8000-000000000001',id,'Auto 1','Olá' from clients where name='Cliente A1';
select throws_ok($$insert into report_automations(agency_id,client_id,name,message_template) select 'faaaaaaa-0000-4000-8000-000000000001',id,'Auto 2','Olá' from clients where name='Cliente A1'$$,'53400',null,'Limite de automações ativas recusa a segunda');
select lives_ok($$insert into report_automations(agency_id,client_id,name,message_template,active) select 'faaaaaaa-0000-4000-8000-000000000001',id,'Auto parada','Olá',false from clients where name='Cliente A1'$$,'Automação inativa não conta');
select throws_ok($$update report_automations set active = true where name = 'Auto parada'$$,'53400',null,'Ativar uma automação também respeita o limite');
select lives_ok($$update report_automations set name = 'Auto 1 editada' where name = 'Auto 1'$$,'Editar automação ativa não é bloqueado');

-- Portal do cliente: recurso não incluído no plano
select throws_ok($$insert into client_portal_invitations(agency_id,client_id,email,expires_at) select 'faaaaaaa-0000-4000-8000-000000000001',id,'cliente@example.test',now()+interval '3 days' from clients where name='Cliente A1'$$,'42501',null,'Recurso fora do plano é recusado no banco');
select lives_ok($$insert into client_portal_invitations(agency_id,client_id,email,expires_at) select 'faaaaaaa-0000-4000-8000-000000000002',id,'cliente@example.test',now()+interval '3 days' from clients where name='Cliente B1'$$,'Organização sem plano atribuído não é restringida');

-- Leitura pela própria organização
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
select is((select used from public.get_agency_entitlements('faaaaaaa-0000-4000-8000-000000000001') where key='clients'),2::bigint,'Dono da organização vê o consumo');
select is((select limit_value from public.get_agency_entitlements('faaaaaaa-0000-4000-8000-000000000001') where key='clients'),2,'... e o limite do plano');
select is((select enabled from public.get_agency_entitlements('faaaaaaa-0000-4000-8000-000000000001') where key='client_portal'),false,'... e os recursos não incluídos');
select throws_ok($$select * from public.get_agency_entitlements('faaaaaaa-0000-4000-8000-000000000002')$$,'42501',null,'Ninguém lê os direitos de outra organização');
select throws_ok($$select * from public.platform_list_agencies()$$,'42501',null,'Dono de organização não lista organizações da plataforma');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Operador lê os direitos efetivos de qualquer organização; outros não
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((select limit_value from public.platform_agency_entitlements('faaaaaaa-0000-4000-8000-000000000001') where key='clients'),2,'Operador vê os direitos efetivos da organização');
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.platform_agency_entitlements('faaaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Dono de organização não usa a consulta administrativa');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Concessões e interruptor global
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select set_config('t.ov',public.platform_grant_override('faaaaaaa-0000-4000-8000-000000000001','clients',null,10,false,null,'Parceiro estratégico')::text,true);
select throws_ok($$select public.platform_grant_override('faaaaaaa-0000-4000-8000-000000000001','clients',null,10,false,now() - interval '1 day','prazo vencido')$$,'22023',null,'Prazo da concessão precisa ser futuro');
select throws_ok($$select public.platform_grant_override('faaaaaaa-0000-4000-8000-000000000001','clients',null,10,false,null,'')$$,'23514',null,'Concessão exige motivo');
select lives_ok($$select public.platform_grant_override('faaaaaaa-0000-4000-8000-000000000001','client_portal',true,null,false,now() + interval '30 days','Demonstração')$$,'Concessão temporária de recurso');
reset role;
select set_config('request.jwt.claim.sub','',true);
select lives_ok($$insert into clients(agency_id,name) values ('faaaaaaa-0000-4000-8000-000000000001','Cliente extra')$$,'Concessão amplia o limite do plano');
select lives_ok($$insert into client_portal_invitations(agency_id,client_id,email,expires_at) select 'faaaaaaa-0000-4000-8000-000000000001',id,'cliente@example.test',now()+interval '3 days' from clients where name='Cliente A1'$$,'Concessão libera o recurso');
select throws_ok($$update private.entitlement_overrides set limit_value = 99$$,'42501',null,'Concessão não pode ser editada');
select throws_ok($$delete from private.entitlement_overrides$$,'42501',null,'Concessão não é apagada');
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_set_feature_switch('client_portal',false,'')$$,'22023',null,'Desativar exige motivo');
select throws_ok($$select public.platform_set_feature_switch('clients',false,'teste de limite')$$,'22023',null,'Limites não têm interruptor global');
select lives_ok($$select public.platform_set_feature_switch('client_portal',false,'Incidente de segurança no portal')$$,'Desativação global do portal');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into client_portal_invitations(agency_id,client_id,email,expires_at) select 'faaaaaaa-0000-4000-8000-000000000001',id,'outro@example.test',now()+interval '3 days' from clients where name='Cliente A1'$$,'42501',null,'Desativação global prevalece sobre a concessão');
select throws_ok($$insert into client_portal_invitations(agency_id,client_id,email,expires_at) select 'faaaaaaa-0000-4000-8000-000000000002',id,'outro@example.test',now()+interval '3 days' from clients where name='Cliente B1'$$,'42501',null,'... e vale também para organização sem plano');
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_set_feature_switch('client_portal',true,null)$$,'Reativação global');
select lives_ok($$select public.platform_revoke_override(current_setting('t.ov')::uuid)$$,'Revoga a concessão de clientes');
select throws_ok($$select public.platform_revoke_override(current_setting('t.ov')::uuid)$$,'22023',null,'Revogar duas vezes é recusado');
select is((select status from public.platform_list_overrides('faaaaaaa-0000-4000-8000-000000000001') where key='clients'),'revogada','Concessão revogada fica no histórico');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into clients(agency_id,name) values ('faaaaaaa-0000-4000-8000-000000000001','Depois da revogação')$$,'53400',null,'Sem a concessão volta o limite do plano');

-- IA (servidor)
set local role service_role;
select is((public.agency_ai_entitlement('faaaaaaa-0000-4000-8000-000000000001') ->> 'allowed')::boolean,true,'Plano com IA permite a IA');
select is((public.agency_ai_entitlement('faaaaaaa-0000-4000-8000-000000000001') ->> 'budget_usd')::numeric,5.00,'Teto de IA vem do plano (US$ 5,00)');
select is((public.agency_ai_entitlement('faaaaaaa-0000-4000-8000-000000000002') ->> 'budget_usd'),null,'Organização sem plano não tem teto comercial');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.agency_ai_entitlement('faaaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Cliente da API não consulta o direito interno da IA');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Versionamento: nova versão publicada não muda quem está na anterior; preços coerentes
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_start_draft(current_setting('t.plan')::uuid)$$,'Cria a versão 3');
select throws_ok($$select public.platform_save_draft(current_setting('t.plan')::uuid,0,100,1300,'[{"key":"clients","limit":50}]'::jsonb)$$,'22023',null,'Preço anual acima de 12 mensalidades é recusado');
select lives_ok($$select public.platform_save_draft(current_setting('t.plan')::uuid,0,100,1200,'[{"key":"clients","limit":50}]'::jsonb)$$,'Preço anual coerente é aceito');
select is(public.platform_publish_draft(current_setting('t.plan')::uuid),3,'Publica a versão 3');
select is((select limit_value from public.platform_agency_entitlements('faaaaaaa-0000-4000-8000-000000000001') where key='clients'),2,'Organização na versão 2 não sofre mudança retroativa da versão 3');
select is((public.platform_get_plan(current_setting('t.plan')::uuid) -> 'versions' -> 1 ->> 'assigned_orgs')::int,1,'Histórico mostra quantas organizações ainda usam a versão antiga');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Atribuição administrativa: motivo obrigatório; assinatura paga (futura) é intocável pelo operador
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_assign_plan('faaaaaaa-0000-4000-8000-000000000001',(select current_version_id from public.platform_list_plans() where key='basico'),null)$$,'22023',null,'Atribuição administrativa exige motivo');
select is((select assignment_kind from public.platform_list_agencies('Organização A')),'administrative','Atribuição do operador é identificada como concessão administrativa');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into private.agency_plan_assignments(agency_id,plan_version_id,kind,note) select 'faaaaaaa-0000-4000-8000-000000000002',current_version_id,'subscription','Criada pela integração de pagamento (simulada)' from private.plans where key='basico';
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_assign_plan('faaaaaaa-0000-4000-8000-000000000002',(select current_version_id from public.platform_list_plans() where key='basico'),'tentativa manual')$$,'22023',null,'Operador não sobrescreve assinatura paga');
select throws_ok($$select public.platform_unassign_plan('faaaaaaa-0000-4000-8000-000000000002')$$,'22023',null,'Operador não remove assinatura paga');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into private.agency_plan_assignments(agency_id,plan_version_id,kind) select 'faaaaaaa-0000-4000-8000-000000000001',current_version_id,'administrative' from private.plans where key='basico' on conflict (agency_id) do update set note = null$$,'23514',null,'Concessão administrativa sem motivo é recusada pelo banco');

-- Trava de concorrência: só quem é gerenciado adquire a trava (antes da contagem)
create temp table lock_probe(before_count int);
insert into lock_probe select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
select is(private.limit_gate('faaaaaaa-0000-4000-8000-000000000002','clients'),50,'Limite efetivo da organização B (versão 3 do plano)');
select is((select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) - (select before_count from lock_probe),1,'Organização gerenciada adquire a trava por organização e recurso');
select is(private.limit_gate('faaaaaaa-0000-4000-8000-0000000000aa','clients'),null,'Organização inexistente/sem plano não adquire trava nem é restringida');

-- Segurança das funções: search_path vazio e permissões de execução
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public','private')
  and p.proname ~ '^(platform_|enforce_|resolve_entitlement|limit_gate|feature_gate|usage_of|require_operator|audit_platform|get_agency_entitlements|agency_ai_entitlement)'
  and not coalesce(p.proconfig @> array['search_path=""'], false)),0,'Toda função SECURITY DEFINER do catálogo fixa search_path vazio');
select is((select coalesce(array_agg(n.nspname || '.' || p.proname order by p.proname), array[]::text[]) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')
  and p.proname ~ '^(platform_|enforce_|resolve_entitlement|limit_gate|feature_gate|usage_of|require_operator|audit_platform|get_agency_entitlements|agency_ai_entitlement)'
  and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) or has_function_privilege('anon', p.oid, 'execute'))),array[]::text[],'Nenhuma função do catálogo é executável por PUBLIC ou anon');
select is((select coalesce(array_agg(p.proname::text order by p.proname), array[]::text[]) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
  and p.proname ~ '^(platform_|enforce_|resolve_entitlement|limit_gate|feature_gate|usage_of|require_operator|audit_platform)' and has_function_privilege('authenticated', p.oid, 'execute')),array[]::text[],'Funções internas (private) não são executáveis pela API');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and p.proname ~ '^(platform_|get_agency_entitlements|agency_ai_entitlement)' and has_function_privilege('service_role', p.oid, 'execute')),array['agency_ai_entitlement'],'service_role só executa o direito interno da IA');

-- Remover o plano devolve a organização ao estado sem restrição
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_unassign_plan('faaaaaaa-0000-4000-8000-000000000001')$$,'Remove o plano atribuído');
select is((select count(*)::int from public.platform_list_agencies('Organização A') where plan_name is not null),0,'Lista de organizações reflete a remoção');
select cmp_ok((select count(*)::int from public.platform_recent_audit(100) where action like 'commercial.%'),'>=',12,'Alterações comerciais ficam na auditoria da plataforma');
reset role;
select set_config('request.jwt.claim.sub','',true);
select lives_ok($$insert into clients(agency_id,name) values ('faaaaaaa-0000-4000-8000-000000000001','Sem restrição de novo')$$,'Organização sem plano volta ao comportamento atual');

select * from finish();
rollback;
