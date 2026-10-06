begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('d0000000-0000-4000-8000-0000000000a1','foto-a@example.test',now()),
('d0000000-0000-4000-8000-0000000000a2','foto-b@example.test',now());

select is((select public from storage.buckets where id='avatars'),true,'Fotos de perfil abrem por link');
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-0000000000a1',true);
select lives_ok($$insert into storage.objects(bucket_id,name) values ('avatars','d0000000-0000-4000-8000-0000000000a1/foto.webp')$$,'Pessoa envia a própria foto');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('avatars','d0000000-0000-4000-8000-0000000000a2/foto.webp')$$,'42501',null,'Não envia foto na pasta de outra pessoa');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('avatars','foto.webp')$$,'42501',null,'Arquivo fora da pasta pessoal é recusado');
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-0000000000a2',true);
select is((select count(*)::int from storage.objects where bucket_id='avatars'),0,'Não lista fotos de outras pessoas');
reset role;
select * from finish();
rollback;
