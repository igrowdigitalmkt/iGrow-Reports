begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
  ('b1000000-0000-4000-8000-000000000001','perf-owner@example.test',now()),
  ('b1000000-0000-4000-8000-000000000002','perf-viewer@example.test',now()),
  ('b1000000-0000-4000-8000-000000000003','perf-outro@example.test',now());
insert into agencies(id,name) values ('b1aaaaaa-0000-4000-8000-000000000001','Espaço Perfil'),('b1aaaaaa-0000-4000-8000-000000000002','Outro Perfil');
insert into agency_users(agency_id,user_id,role) values
  ('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','owner'),
  ('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','viewer'),
  ('b1aaaaaa-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000003','owner');
insert into clients(id,agency_id,name,created_by) values
  ('b1cccccc-0000-4000-8000-000000000001','b1aaaaaa-0000-4000-8000-000000000001','Cliente Perfil','b1000000-0000-4000-8000-000000000001'),
  ('b1cccccc-0000-4000-8000-000000000002','b1aaaaaa-0000-4000-8000-000000000002','Cliente de outro espaço','b1000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select lives_ok($$insert into client_profiles(client_id,agency_id,segment,goal) values ('b1cccccc-0000-4000-8000-000000000001','b1aaaaaa-0000-4000-8000-000000000001','Imobiliária','Mais visitas aos imóveis')$$,'Dono cria o perfil com campos parciais');
select lives_ok($$update client_profiles set location='Teresina, PI' where client_id='b1cccccc-0000-4000-8000-000000000001'$$,'Dono atualiza o perfil');
select is((select location from client_profiles where client_id='b1cccccc-0000-4000-8000-000000000001'),'Teresina, PI','Atualização gravada');
select throws_ok($$insert into client_profiles(client_id,agency_id,segment) values ('b1cccccc-0000-4000-8000-000000000002','b1aaaaaa-0000-4000-8000-000000000001','x')$$,'42501',null,'Cliente de outro espaço não vira perfil desta organização');
select throws_ok($$update client_profiles set segment=repeat('a',121) where client_id='b1cccccc-0000-4000-8000-000000000001'$$,'23514',null,'Campo acima do limite é recusado');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from client_profiles),1,'Leitor consulta o perfil');
select lives_ok($$update client_profiles set segment='Alterado'$$,'Leitor tenta alterar o perfil sem efeito (RLS filtra as linhas)');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from client_profiles where segment='Alterado'),0,'Nada foi alterado pelo leitor');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from client_profiles),0,'Outra organização não vê o perfil');
reset role;
set local role anon;
select throws_ok($$select count(*) from client_profiles$$,'42501',null,'Anônimo não acessa perfis');
reset role;
select * from finish();
rollback;
