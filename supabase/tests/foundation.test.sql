begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Deliberately fictitious identities. The entire suite rolls back.
insert into auth.users(id,email,email_confirmed_at) values
  ('10000000-0000-0000-0000-000000000001','owner-a@example.test',now()),
  ('10000000-0000-0000-0000-000000000002','owner-b@example.test',now()),
  ('10000000-0000-0000-0000-000000000003','viewer@example.test',now()),
  ('10000000-0000-0000-0000-000000000004','editor@example.test',now()),
  ('10000000-0000-0000-0000-000000000005','admin@example.test',now()),
  ('10000000-0000-0000-0000-000000000006','outsider@example.test',now()),
  ('10000000-0000-0000-0000-000000000007','invitee@example.test',now()),
  ('10000000-0000-0000-0000-000000000008','unconfirmed@example.test',null),
  ('10000000-0000-0000-0000-000000000009','prospective-owner@example.test',now());
insert into public.agencies(id,name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Agência fictícia A'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Agência fictícia B');
insert into public.agency_users(agency_id,user_id,role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','viewer'),
  ('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','editor'),
  ('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','admin');
insert into public.clients(id,agency_id,name,created_by) values
  ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Cliente fictício A','10000000-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','Cliente fictício B','10000000-0000-0000-0000-000000000002');
insert into storage.objects(bucket_id,name) values
  ('agency-assets','aaaaaaaa-0000-0000-0000-000000000001/logo.png'),
  ('agency-assets','bbbbbbbb-0000-0000-0000-000000000002/logo.png'),
  ('report-pdfs','aaaaaaaa-0000-0000-0000-000000000001/version/report.pdf');
create temporary table test_invites(label text, invitation_id uuid, token text, expires_at timestamptz);
grant all on test_invites to authenticated;

select is((select count(*) from pg_tables where schemaname = 'public' and tablename in
  ('agencies','agency_users','agency_invitations','clients','audit_logs') and rowsecurity),5::bigint,'Todas as tabelas expostas têm RLS');
select is((select count(*) from storage.buckets where id in ('agency-assets','client-assets','report-assets','report-pdfs') and public = false),4::bigint,'Os quatro buckets são privados');
select ok(not has_function_privilege('authenticated','private.bootstrap_agency(text,text,text)','EXECUTE'),'Bootstrap não é executável por authenticated');
select ok(not has_function_privilege('service_role','private.bootstrap_agency(text,text,text)','EXECUTE'),'Bootstrap não é executável por service_role');
select throws_ok($$insert into public.clients(agency_id,name,created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Referência inválida','10000000-0000-0000-0000-000000000002')$$,
  '23503',null,'FK composta rejeita autor de outra agência, inclusive como postgres');

set local role anon;
select throws_ok($$select * from public.agencies$$,'42501',null,'Visitante não lê agências');
select throws_ok($$select * from public.clients$$,'42501',null,'Visitante não lê clientes');
select throws_ok($$select public.accept_agency_invitation(repeat('a',64))$$,'42501',null,'Visitante não executa aceite');
select is((select count(*) from storage.objects),0::bigint,'Visitante não lê assets');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.agencies),1::bigint,'Proprietário A lê somente sua agência');
select is((select count(*) from public.clients),1::bigint,'Proprietário A lê somente seus clientes');
select is((select count(*) from public.agency_users),4::bigint,'Equipe da outra agência é invisível');
select results_eq($$with changed as (update public.clients set name = 'Ataque' where agency_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning id) select count(*)::integer from changed$$,array[0],'Não altera cliente da outra agência');
select throws_ok($$insert into public.clients(agency_id,name) values ('bbbbbbbb-0000-0000-0000-000000000002','Ataque')$$,'42501',null,'Não insere cliente em outra agência');
select throws_ok($$update public.clients set agency_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$,'42501',null,'Coluna agency_id não pode ser transferida');
select throws_ok($$delete from public.clients$$,'42501',null,'Clientes são arquivados; exclusão direta não é permitida');
select throws_ok($$insert into public.agencies(name) values ('Auto cadastro')$$,'42501',null,'Não existe cadastro público de agências');
select throws_ok($$update public.agencies set timezone = 'Fuso/Invalido'$$,'22023',null,'Fuso IANA inválido é rejeitado');
select throws_ok($$select public.set_agency_member_role('bbbbbbbb-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','viewer')$$,'42501',null,'RPC não altera membro de outra agência');
select throws_ok($$select public.remove_agency_member('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$$,'23514',null,'Último proprietário não pode ser removido');
select throws_ok($$select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','admin')$$,'23514',null,'Último proprietário não pode ser rebaixado');
select is((select count(*) from storage.objects),2::bigint,'Assets lidos somente na própria agência');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('agency-assets','bbbbbbbb-0000-0000-0000-000000000002/invasao.png')$$,'42501',null,'Não escreve asset de outra agência');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('report-pdfs','aaaaaaaa-0000-0000-0000-000000000001/forjado.pdf')$$,'42501',null,'PDFs reservados para o pipeline; browser não escreve');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('client-assets','aaaaaaaa-0000-0000-0000-000000000001/22222222-0000-0000-0000-000000000002/logo.png')$$,'42501',null,'Caminho de asset não associa cliente de outra agência');
select lives_ok($$insert into storage.objects(bucket_id,name) values ('agency-assets','aaaaaaaa-0000-0000-0000-000000000001/logo-2.png')$$,'Owner pode escrever logo da própria agência');
select throws_ok($$update storage.objects set name = 'bbbbbbbb-0000-0000-0000-000000000002/movido.png' where name = 'aaaaaaaa-0000-0000-0000-000000000001/logo-2.png'$$,'42501',null,'WITH CHECK impede mover asset para outra agência');
select results_eq($$with changed as (delete from storage.objects where name = 'bbbbbbbb-0000-0000-0000-000000000002/logo.png' returning id) select count(*)::integer from changed$$,array[0],'Não remove asset da outra agência');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('agency-assets','nao-e-uuid/logo.png')$$,'42501',null,'Caminho sem UUID de agência é rejeitado');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('agency-assets','aaaaaaaa-0000-0000-0000-000000000001/../logo.png')$$,'42501',null,'Caminho com travessia de diretórios é rejeitado');
select results_eq($$with changed as (delete from storage.objects where bucket_id = 'report-pdfs' returning id) select count(*)::integer from changed$$,array[0],'Browser não remove PDF reservado ao pipeline');
select throws_ok($$select token_hash from public.agency_invitations$$,'42501',null,'Hash do convite não é exposto ao navegador');
insert into test_invites select 'valid',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','invitee@example.test','editor');
insert into test_invites select 'owner',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','prospective-owner@example.test','owner');
insert into test_invites select 'unconfirmed',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','unconfirmed@example.test','viewer');
insert into test_invites select 'existing',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','viewer@example.test','owner');
select ok((select token ~ '^[a-f0-9]{64}$' from test_invites where label = 'valid'),'Token tem formato de 64 hexadecimais');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.clients),1::bigint,'Leitor consulta clientes próprios');
select throws_ok($$insert into public.clients(agency_id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Proibido')$$,'42501',null,'Leitor não insere clientes');
select results_eq($$with changed as (update public.clients set name = 'Proibido' returning id) select count(*)::integer from changed$$,array[0],'Leitor não altera clientes');
select throws_ok($$update public.agency_users set role = 'owner'$$,'42501',null,'Associações não podem ser escritas diretamente');
select throws_ok($$select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','owner')$$,'42501',null,'Leitor não se autopromove por RPC');
select throws_ok($$select public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','x@example.test','viewer')$$,'42501',null,'Leitor não emite convites');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('agency-assets','aaaaaaaa-0000-0000-0000-000000000001/leitor.png')$$,'42501',null,'Leitor não escreve Storage');
select results_eq($$with changed as (update storage.objects set name = name || '.renomeado' returning id) select count(*)::integer from changed$$,array[0],'Leitor não altera assets existentes');
select results_eq($$with changed as (delete from storage.objects returning id) select count(*)::integer from changed$$,array[0],'Leitor não remove assets existentes');
select is((select count(*) from public.audit_logs),0::bigint,'Leitor não acessa auditoria administrativa');
select lives_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'existing'))$$,'Membro existente pode consumir convite');
select is((select role::text from public.agency_users where user_id = auth.uid()),'viewer','Convite não promove um membro existente');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
select lives_ok($$insert into public.clients(agency_id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Cliente criado por editor')$$,'Editor pode cadastrar cliente');
select lives_ok($$update public.clients set archived_at = now() where id = '11111111-0000-0000-0000-000000000001'$$,'Editor pode arquivar cliente');
select throws_ok($$select public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','x@example.test','viewer')$$,'42501',null,'Editor não administra convites');
select throws_ok($$select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','admin')$$,'42501',null,'Editor não se autopromove por RPC');
select results_eq($$with changed as (update public.agencies set name = 'Proibido' returning id) select count(*)::integer from changed$$,array[0],'Editor não altera configuração da agência');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('agency-assets','aaaaaaaa-0000-0000-0000-000000000001/editor.png')$$,'42501',null,'Editor não altera identidade da agência');
select lives_ok($$insert into storage.objects(bucket_id,name) values ('client-assets','aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000001/editor.png')$$,'Editor escreve asset do cliente da própria agência');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
select throws_ok($$select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','owner')$$,'42501',null,'Admin não se promove a proprietário');
select throws_ok($$select public.remove_agency_member('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$$,'42501',null,'Admin não remove proprietário');
select throws_ok($$select public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','outro@example.test','owner')$$,'42501',null,'Admin não convida proprietário');
select throws_ok($$select public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','prospective-owner@example.test','editor')$$,'42501',null,'Admin não substitui convite owner por convite de outro papel');
select throws_ok($$select public.revoke_agency_invitation((select invitation_id from test_invites where label = 'owner'))$$,'42501',null,'Admin não revoga convite owner');
select lives_ok($$select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','viewer')$$,'Admin pode alterar papel operacional');
insert into test_invites select 'expired',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','outsider@example.test','viewer');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
select is((select count(*) from public.agencies),0::bigint,'Usuário sem associação não lê agências');
select is((select count(*) from public.clients),0::bigint,'Usuário sem associação não lê clientes');
select is((select count(*) from storage.objects),0::bigint,'Usuário sem associação não lê Storage');
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'valid'))$$,'22023',null,'Token não funciona para email diferente');
select throws_ok($$insert into public.audit_logs(agency_id,action) values ('aaaaaaaa-0000-0000-0000-000000000001','forged')$$,'42501',null,'Usuário não forja auditoria');

reset role;
update public.agency_invitations set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
  where id = (select invitation_id from test_invites where label = 'expired');
set local role authenticated;
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'expired'))$$,'22023',null,'Convite expirado é rejeitado');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000008',true);
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'unconfirmed'))$$,'22023',null,'Conta sem email confirmado não aceita convite');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
select is(public.accept_agency_invitation((select token from test_invites where label = 'valid')),'aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Aceite retorna agência correta');
select is((select role::text from public.agency_users where user_id = auth.uid()),'editor','Aceite cria a associação no papel convidado');
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'valid'))$$,'22023',null,'Convite consumido não pode ser reutilizado');
select throws_ok($$select public.accept_agency_invitation('invalid')$$,'22023',null,'Token malformado é rejeitado');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.revoke_agency_invitation((select invitation_id from test_invites where label = 'owner'))$$,'Owner revoga convite');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000009',true);
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'owner'))$$,'22023',null,'Convite revogado não pode ser consumido');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
insert into test_invites select 'demoted-issuer',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','outsider@example.test','viewer');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','viewer');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'demoted-issuer'))$$,'22023',null,'Convite perde validade quando emissor perde permissão de equipe');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into test_invites select 'replaced-token',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','outsider@example.test','viewer');
insert into test_invites select 'replacement-token',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','outsider@example.test','editor');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'replaced-token'))$$,'22023',null,'Reemitir convite revoga token anterior');
select lives_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'replacement-token'))$$,'Token novo permanece válido após reemissão');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','owner')$$,'Owner pode nomear outro proprietário');
select lives_ok($$select public.set_agency_member_role('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','admin')$$,'Proprietário pode sair do papel quando há outro proprietário');
select ok((select count(*) > 0 from public.audit_logs),'Mudanças sensíveis deixam auditoria');
insert into test_invites select 'removed-issuer',* from public.issue_agency_invitation('aaaaaaaa-0000-0000-0000-000000000001','prospective-owner@example.test','viewer');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
select lives_ok($$select public.remove_agency_member('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$$,'Owner remove administrador sem apagar históricos relacionados');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000009',true);
select throws_ok($$select public.accept_agency_invitation((select token from test_invites where label = 'removed-issuer'))$$,'22023',null,'Convite perde validade quando emissor é removido');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.agencies),0::bigint,'Membro removido perde acesso à agência imediatamente');
select is((select count(*) from storage.objects),0::bigint,'Membro removido perde acesso aos assets imediatamente');

reset role;
select throws_ok($$select private.bootstrap_agency('unconfirmed@example.test','Agência sem confirmação')$$,'22023',null,'Bootstrap exige proprietário com email confirmado');
select lives_ok($$select private.bootstrap_agency('invitee@example.test','Agência criada pelo operador')$$,'Operador cria agência e primeiro proprietário com conta confirmada');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
select lives_ok($$insert into public.clients(agency_id,name,notes) values ('aaaaaaaa-0000-0000-0000-000000000001','Cliente auditoria','Observação confidencial')$$,'Cadastro de cliente persiste com auditoria');
select lives_ok($$update public.clients set name='Cliente auditoria editado' where name='Cliente auditoria'$$,'Edição de cliente persiste');
select lives_ok($$update public.clients set archived_at=now() where name='Cliente auditoria editado'$$,'Arquivamento mantém registro');
select is((select count(*) from public.clients where name='Cliente auditoria editado' and archived_at is not null),1::bigint,'Cliente arquivado permanece consultável');
select lives_ok($$update public.clients set archived_at=null where name='Cliente auditoria editado'$$,'Cliente pode ser reativado');
select is((select count(distinct action) from public.audit_logs where entity_id=(select id from public.clients where name='Cliente auditoria editado') and actor_id=auth.uid()),4::bigint,'Auditoria registra criação, edição, arquivamento e reativação com autor');
select ok(not exists(select 1 from public.audit_logs where metadata::text like '%Observação confidencial%'),'Auditoria não copia observações confidenciais');
reset role;
select * from finish();
rollback;
