begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('e2000000-0000-4000-8000-000000000001','operador@example.test',now()),
('e2000000-0000-4000-8000-000000000002','dono@example.test',now());
insert into agencies(id,name) values ('e2aaaaaa-0000-4000-8000-000000000001','Org A');
insert into agency_users(agency_id,user_id,role) values ('e2aaaaaa-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','owner');
insert into private.platform_operators(user_id,role) values ('e2000000-0000-4000-8000-000000000001','owner');

-- Permissões: administração só para autenticados (conferem o operador); a leitura dos segredos SÓ para o servidor.
select ok(has_function_privilege('authenticated','public.platform_asaas_save_key(text,text,text,boolean)','execute')
  and has_function_privilege('authenticated','public.platform_asaas_rotate_webhook_token(text,integer)','execute')
  and has_function_privilege('authenticated','public.platform_asaas_get_state(text)','execute')
  and not has_function_privilege('anon','public.platform_asaas_save_key(text,text,text,boolean)','execute')
  and not has_function_privilege('anon','public.platform_asaas_get_state(text)','execute'),'Administração: autenticados (com checagem de operador), nunca anônimos');
select ok(has_function_privilege('service_role','public.asaas_read_credentials()','execute')
  and not has_function_privilege('authenticated','public.asaas_read_credentials()','execute')
  and not has_function_privilege('anon','public.asaas_read_credentials()','execute'),'Leitura dos segredos: somente o service_role');
select ok(not has_function_privilege('service_role','public.platform_asaas_save_key(text,text,text,boolean)','execute'),'O servidor privilegiado não grava pelas funções de operador');
select ok(not has_table_privilege('authenticated','private.asaas_integration','select') and not has_table_privilege('anon','private.asaas_integration','select')
  and not has_table_privilege('service_role','private.asaas_integration','select') and not has_schema_privilege('authenticated','vault','usage'),'Sem acesso direto à tabela de estado nem ao Vault');
select ok((select relrowsecurity from pg_class where oid='private.asaas_integration'::regclass),'Tabela de estado com RLS ligado');

-- Quem não é operador (ou está sem MFA) é barrado em todas as funções.
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_asaas_get_state('sandbox')$$,'42501',null,'Proprietário de organização não lê o estado da integração');
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000000','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'42501',null,'Proprietário não registra chave');
select throws_ok($$select public.platform_asaas_rotate_webhook_token('tok_0000000000000000000000000000000000',60)$$,'42501',null,'Proprietário não gira o token');
select throws_ok($$select public.platform_asaas_revoke_previous_token()$$,'42501',null,'Proprietário não revoga o token anterior');
select throws_ok($$select public.platform_asaas_record_check('connection','connected')$$,'42501',null,'Proprietário não registra verificações');
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($$select public.platform_asaas_get_state('sandbox')$$,'42501',null,'Operador sem MFA não lê o estado');
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000000','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'42501',null,'Operador sem MFA não registra chave');
select throws_ok($$select public.platform_asaas_rotate_webhook_token('tok_0000000000000000000000000000000000',60)$$,'42501',null,'Operador sem MFA não gira o token');
reset role;
select is((select count(*)::int from private.asaas_integration where api_key_secret_id is not null or webhook_token_secret_id is not null),0,'Nenhuma tentativa barrada gravou algo');
select is((select count(*)::int from vault.secrets),0,'... nem criou segredo no Vault');

set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);

-- Validações da chave
select throws_ok($$select public.platform_asaas_save_key('outro','$aact_hmlg_000000000000000000000000','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'22023',null,'Ambiente inválido é recusado');
select throws_ok($$select public.platform_asaas_save_key('sandbox','curta','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'22023',null,'Chave curta é recusada');
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_0000 0000000000000000','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'22023',null,'Chave com espaço é recusada');
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_prod_000000000000000000000000','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'22023',null,'Chave de produção no Sandbox é recusada');
select throws_ok($$select public.platform_asaas_save_key('production','$aact_hmlg_000000000000000000000000','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'22023',null,'Chave de Sandbox em Produção é recusada');
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000000','nao-e-hash')$$,'22023',null,'Impressão digital inválida é recusada');
reset role;
select is((select count(*)::int from vault.secrets),0,'Entradas inválidas não gravam segredo');

-- Registro válido (Sandbox, sem registros financeiros)
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'Operador com MFA registra a chave do Sandbox');
select is((public.platform_asaas_get_state('production') ->> 'environment'),'sandbox','O ambiente ativo é o registrado (não o sugerido)');
select is((public.platform_asaas_get_state('sandbox') ->> 'key_configured')::boolean,true,'Estado: chave configurada');
select is((public.platform_asaas_get_state('sandbox') ->> 'key_status'),'connected','Estado: validada (o servidor validou antes de gravar)');
select is((public.platform_asaas_get_state('sandbox') ->> 'live_enabled')::boolean,false,'Estado: cobrança real continua desligada');
select ok(not (public.platform_asaas_get_state('sandbox')::text ~* '(aact|secret_id|decrypted|fingerprint)'),'O estado NÃO traz chave, identificador de segredo nem impressão digital');
reset role;
select is((select live_enabled from private.billing_settings),false,'Registrar credenciais não liga cobrança (live_enabled intacto)');
select ok(not exists (select 1 from private.asaas_integration t where t::text like '%aact%'),'Nenhuma coluna da tabela de estado contém a chave');
select ok(not exists (select 1 from private.platform_audit_log where metadata::text like '%aact%' or metadata::text like '%000000000000000000000001%'),'A auditoria não contém a chave');
select is((select count(*)::int from private.platform_audit_log where action='integration.asaas_key_saved'),1,'O registro da chave foi auditado');

-- Leitura pelo servidor
set local role service_role;
select is((public.asaas_read_credentials() ->> 'api_key'),'$aact_hmlg_000000000000000000000001','O servidor lê a chave ativa');
select is((public.asaas_read_credentials() ->> 'environment'),'sandbox','... e o ambiente');
select ok((public.asaas_read_credentials() -> 'webhook_token') is not distinct from 'null'::jsonb,'Sem token do webhook ainda');
reset role;

-- Substituição na MESMA conta (sem registros): vale na hora
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000002','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'Substituir a chave na mesma conta é permitido');
reset role;
set local role service_role;
select is((public.asaas_read_credentials() ->> 'api_key'),'$aact_hmlg_000000000000000000000002','A nova chave já é a lida pelo servidor (sem novo deploy)');
reset role;
select is((select count(*)::int from vault.secrets where name='igrow_asaas_api_key'),1,'A chave é atualizada no mesmo segredo (sem duplicar)');

-- Token do webhook
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_asaas_rotate_webhook_token('curto',60)$$,'22023',null,'Token curto é recusado');
select throws_ok($$select public.platform_asaas_rotate_webhook_token('token com espaco 00000000000000000000000',60)$$,'22023',null,'Token com caracteres inválidos é recusado');
select throws_ok($$select public.platform_asaas_rotate_webhook_token('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',2000)$$,'22023',null,'Transição fora de 0 a 1440 minutos é recusada');
select throws_ok($$select public.platform_asaas_rotate_webhook_token('$aact_hmlg_000000000000000000000002',60)$$,'22023',null,'Token com formato de chave de API é recusado');
select lives_ok($$select public.platform_asaas_rotate_webhook_token('tok_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',60)$$,'Primeiro token é registrado');
select is((public.platform_asaas_get_state('sandbox') ->> 'webhook_token_configured')::boolean,true,'Estado: token configurado');
select is((public.platform_asaas_get_state('sandbox') ->> 'previous_token_active')::boolean,false,'Primeiro token: não há anterior');
reset role;
set local role service_role;
select is((public.asaas_read_credentials() ->> 'webhook_token'),'tok_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','O servidor lê o token atual');
select ok((public.asaas_read_credentials() -> 'webhook_token_previous') is not distinct from 'null'::jsonb,'Ainda sem token anterior');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_asaas_rotate_webhook_token('tok_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',60)$$,'Rotação com transição de 60 minutos');
select is((public.platform_asaas_get_state('sandbox') ->> 'previous_token_active')::boolean,true,'Estado: token anterior em transição');
reset role;
set local role service_role;
select is((public.asaas_read_credentials() ->> 'webhook_token'),'tok_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','Novo token vale');
select is((public.asaas_read_credentials() ->> 'webhook_token_previous'),'tok_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','Token anterior vale durante a transição');
reset role;
update private.asaas_integration set webhook_prev_expires_at = now() - interval '1 minute';
set local role service_role;
select ok((public.asaas_read_credentials() -> 'webhook_token_previous') is not distinct from 'null'::jsonb,'Vencida a transição, o token anterior deixa de valer');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_asaas_rotate_webhook_token('tok_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',30)$$,'Nova rotação');
select lives_ok($$select public.platform_asaas_revoke_previous_token()$$,'O operador encerra a transição na hora');
reset role;
set local role service_role;
select ok((public.asaas_read_credentials() -> 'webhook_token_previous') is not distinct from 'null'::jsonb,'Token anterior revogado deixa de valer imediatamente');
select is((public.asaas_read_credentials() ->> 'webhook_token'),'tok_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC','O token atual segue valendo');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_asaas_rotate_webhook_token('tok_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',0)$$,'Rotação sem transição');
reset role;
set local role service_role;
select ok((public.asaas_read_credentials() -> 'webhook_token_previous') is not distinct from 'null'::jsonb,'Sem transição: o anterior nunca vale');
reset role;
select ok(not exists (select 1 from private.platform_audit_log where metadata::text like '%tok\_%'),'A auditoria não contém tokens');
select ok(not exists (select 1 from private.asaas_integration t where t::text like '%tok\_%'),'A tabela de estado não contém tokens');
select is((select count(*)::int from private.platform_audit_log where action='integration.asaas_webhook_token_rotated'),4,'Cada rotação foi auditada');

-- Verificações registradas
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_asaas_record_check('connection','talvez')$$,'22023',null,'Resultado inválido é recusado');
select throws_ok($$select public.platform_asaas_record_check('outra','ok')$$,'22023',null,'Verificação inválida é recusada');
select lives_ok($$select public.platform_asaas_record_check('connection','auth_failed')$$,'Falha de autenticação é registrada');
select is((public.platform_asaas_get_state('sandbox') ->> 'key_status'),'auth_failed','Estado reflete a falha');
select lives_ok($$select public.platform_asaas_record_check('webhook','ok')$$,'Webhook conferido é registrado');
select is((public.platform_asaas_get_state('sandbox') ->> 'webhook_status'),'ok','Estado: webhook ok');
reset role;

-- Proteção contra troca de conta: registros financeiros ligados ao ambiente
insert into private.billing_customers(agency_id,environment,asaas_customer_id,synthetic) values ('e2aaaaaa-0000-4000-8000-000000000001','sandbox','cus_real_0001',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((public.platform_asaas_get_state('sandbox') -> 'links' ->> 'customers')::int,1,'Estado mostra os registros que prendem a conta');
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000003','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,'22023','Esta chave pertence a OUTRA conta Asaas e já existem assinaturas, pagamentos, contratações ou eventos vinculados à conta atual. Trocar de conta exige um procedimento de migração e não é feito por esta tela.','Trocar de conta com registros existentes é BLOQUEADO');
select lives_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000004','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'Rotação na MESMA conta continua permitida com registros existentes');
reset role;
set local role service_role;
select is((public.asaas_read_credentials() ->> 'api_key'),'$aact_hmlg_000000000000000000000004','A chave bloqueada não foi aplicada; a rotação válida sim');
reset role;
-- Produção não é afetada pelos registros do Sandbox (ambientes separados) e registrar a chave não libera cobrança
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_asaas_save_key('production','$aact_prod_000000000000000000000001','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')$$,'Chave de produção pode ser registrada sem registros de produção');
select is((public.platform_asaas_get_state('sandbox') ->> 'environment'),'production','Ambiente ativo passa a produção');
reset role;
select is((select live_enabled from private.billing_settings),false,'Registrar a chave de produção NÃO liga a cobrança real');
-- Voltar ao Sandbox exige a mesma conta de antes (impressão digital por ambiente)
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000005','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$$,'22023',null,'Voltar ao Sandbox com OUTRA conta continua bloqueado');
select lives_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000005','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'... e com a mesma conta é permitido');
reset role;

-- Primeira conta registrada com registros já existentes (ambiente configurado antes por variáveis): exige confirmação
update private.asaas_integration set sandbox_fingerprint = null;
set local role authenticated;
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000006','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')$$,'22023',null,'Conta ainda não registrada + registros existentes: exige confirmação');
select lives_ok($$select public.platform_asaas_save_key('sandbox','$aact_hmlg_000000000000000000000006','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',true)$$,'Com a confirmação explícita do operador, registra');
reset role;
select ok(exists (select 1 from private.platform_audit_log where action='integration.asaas_key_saved' and (metadata->>'financial_records')::int > 0),'A auditoria registra quantos registros financeiros existiam');

-- Eventos não resolvidos também prendem a conta
update private.billing_customers set synthetic = true;
insert into private.billing_events(environment,asaas_event_id,event_type,resource_type,payload,status) values ('sandbox','evt_x&1','PAYMENT_CREATED','payment','{}','received');
select is((private.asaas_financial_links('sandbox') ->> 'open_events')::int,1,'Evento pendente conta como vínculo');
select is((private.asaas_financial_links('sandbox') ->> 'customers')::int,0,'Cliente sintético (teste) não conta');
select * from finish();
rollback;
