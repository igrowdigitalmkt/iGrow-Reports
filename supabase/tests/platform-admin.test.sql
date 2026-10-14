begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('d0000000-0000-4000-8000-000000000001','dono-plataforma@example.test',now()),
('d0000000-0000-4000-8000-000000000002','dono-agencia@example.test',now()),
('d0000000-0000-4000-8000-000000000003','inativo@example.test',now()),
('d0000000-0000-4000-8000-000000000004','sem-confirmar@example.test',null),
('d0000000-0000-4000-8000-000000000005','segundo@example.test',now());
insert into agencies(id,name) values ('daaaaaaa-0000-4000-8000-000000000001','Agência Cliente');
insert into agency_users(agency_id,user_id,role) values ('daaaaaaa-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','owner');

-- Estrutura: RLS ligado e nenhum privilégio de tabela para os papéis da API.
select ok((select relrowsecurity from pg_class where oid='private.platform_operators'::regclass),'RLS ligado em platform_operators');
select ok((select relrowsecurity from pg_class where oid='private.platform_audit_log'::regclass),'RLS ligado em platform_audit_log');
select ok(not has_table_privilege('authenticated','private.platform_operators','select') and not has_table_privilege('anon','private.platform_audit_log','select')
  and not has_table_privilege('service_role','private.platform_audit_log','insert'),'Papéis da API não têm acesso direto às tabelas');
select ok(not has_function_privilege('authenticated','private.provision_platform_owner(text)','execute')
  and not has_function_privilege('service_role','private.provision_platform_owner(text)','execute')
  and not has_function_privilege('authenticated','private.deactivate_platform_operator(uuid)','execute'),'Provisionar e desativar não são executáveis pela API');
select ok(not has_function_privilege('service_role','public.platform_record_audit(text,text,text,text,jsonb)','execute') and not has_function_privilege('service_role','public.platform_operator_status()','execute'),'service_role não executa as funções do Super Admin');
select ok(not has_function_privilege('anon','public.platform_operator_status()','execute')
  and not has_function_privilege('anon','public.platform_record_audit(text,text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.platform_recent_audit(integer)','execute'),'anon não executa as funções do Super Admin');

-- Provisionamento (papel de banco, como no SQL Editor).
select throws_ok($$select private.provision_platform_owner('nao-existe@example.test')$$,'22023',null,'Provisionar exige conta existente');
select throws_ok($$select private.provision_platform_owner('sem-confirmar@example.test')$$,'22023',null,'Provisionar exige e-mail confirmado');
select is(private.provision_platform_owner(' Dono-Plataforma@example.test '),'d0000000-0000-4000-8000-000000000001'::uuid,'Primeiro proprietário provisionado por e-mail existente');
select throws_ok($$select private.provision_platform_owner('segundo@example.test')$$,'23514',null,'Não provisiona segundo proprietário pelo procedimento inicial');
select is((select count(*)::int from private.platform_audit_log where action='platform.owner_provisioned'),1,'Provisionamento é auditado');
-- Operador inativo (inserido direto como o dono do banco).
insert into private.platform_operators(user_id,role,active,deactivated_at) values ('d0000000-0000-4000-8000-000000000003','owner',false,now());

set local role authenticated;
select throws_ok($$select * from private.platform_operators$$,'42501',null,'Usuário comum não lê operadores');
select throws_ok($$insert into private.platform_operators(user_id,role) values ('d0000000-0000-4000-8000-000000000002','owner')$$,'42501',null,'Usuário comum não se concede acesso');
select throws_ok($$select private.provision_platform_owner('dono-agencia@example.test')$$,'42501',null,'Usuário comum não executa o provisionamento');

-- Proprietário de uma organização cliente NÃO é operador.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is(public.platform_operator_status(),null,'Proprietário de organização (mesmo com MFA) não é operador');
select throws_ok($$select public.platform_record_audit('admin.mfa_verified')$$,'42501',null,'Não operador não grava auditoria');
select throws_ok($$select * from public.platform_recent_audit(5)$$,'42501',null,'Não operador não lê auditoria');
select ok((select count(*) from agencies)=1,'Isolamento das organizações segue igual');

-- Operador inativo.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000003',true);
select is(public.platform_operator_status(),null,'Operador inativo não é reconhecido');
select throws_ok($$select * from public.platform_recent_audit(5)$$,'42501',null,'Operador inativo não lê auditoria');

-- Operador ativo sem MFA (aal1).
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select is(public.platform_operator_status(),'{"role":"owner","aal":"aal1"}'::jsonb,'Operador ativo é reconhecido com aal1');
select throws_ok($$select * from public.platform_recent_audit(5)$$,'42501',null,'Sem MFA não lê a auditoria');
select throws_ok($$select public.platform_record_audit('admin.alterou_plano')$$,'42501',null,'Sem MFA só registra eventos do fluxo de MFA');
select lives_ok($$select public.platform_record_audit('admin.mfa_enrolled','platform_operator',null,'success')$$,'Sem MFA registra o cadastro do segundo fator');

-- Operador ativo com MFA validado (aal2).
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is(public.platform_operator_status(),'{"role":"owner","aal":"aal2"}'::jsonb,'Operador com MFA validado tem aal2');
select lives_ok($$select public.platform_record_audit('admin.session_started','platform_operator',null,'success','{"via":"totp"}')$$,'Com MFA registra eventos administrativos');
select throws_ok($$select public.platform_record_audit('Ação Inválida')$$,'23514',null,'Nome de ação fora do padrão é recusado');
select throws_ok($$select public.platform_record_audit('admin.teste',null,null,'sucesso')$$,'23514',null,'Resultado fora do padrão é recusado');
select is((select count(*)::int from public.platform_recent_audit(10)),3,'Com MFA lê a trilha de auditoria');
select is((select actor_email from public.platform_recent_audit(1)),'dono-plataforma@example.test','Auditoria identifica o operador responsável');
select throws_ok($$update private.platform_audit_log set outcome='failure'$$,'42501',null,'Operador não altera a auditoria diretamente');
reset role;
select throws_ok($$update private.platform_audit_log set outcome='failure'$$,'42501',null,'Nem o dono do banco altera a auditoria');
select throws_ok($$delete from private.platform_audit_log$$,'42501',null,'Nem o dono do banco apaga a auditoria');
select throws_ok($$truncate private.platform_audit_log$$,'42501',null,'Nem o dono do banco esvazia a auditoria');
select throws_ok($$delete from private.platform_operators$$,'42501',null,'Operadores não são apagados');

-- Teto de eventos sem MFA: 30 por hora por operador.
insert into private.platform_audit_log(actor_id,action,outcome) select 'd0000000-0000-4000-8000-000000000001','admin.mfa_failed','failure' from generate_series(1,30);
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($$select public.platform_record_audit('admin.mfa_failed')$$,'54000',null,'Sem MFA há teto de eventos por hora');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_record_audit('admin.session_started')$$,'Com MFA o teto não se aplica');
reset role;

-- Desativação: protege o último proprietário ativo.
select throws_ok($$select private.deactivate_platform_operator('d0000000-0000-4000-8000-000000000001')$$,'23514',null,'Não desativa o último proprietário ativo');
insert into private.platform_operators(user_id,role) values ('d0000000-0000-4000-8000-000000000005','owner');
select lives_ok($$select private.deactivate_platform_operator('d0000000-0000-4000-8000-000000000001')$$,'Desativa quando há outro proprietário ativo');
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select is(public.platform_operator_status(),null,'Operador desativado perde o acesso imediatamente');
reset role;
select * from finish();
rollback;
