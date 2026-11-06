-- Desempenho do painel: o "resumo pronto" de cada periodo (public.meta_dashboard_scopes.payload) chegava a 1,2 MB comprimido (5,7 MB como texto),
-- quase todo na chave entityValues (valores de cada campanha, conjunto e anuncio). Cada abertura do painel lia e copiava esse JSON inteiro
-- (~350 ms, varias vezes por tela) e, com 2 a 3 pedidos juntos, passava do limite de 8 s do banco (statement timeout).
--
-- Solucao transparente: os valores por entidade passam a viver numa tabela propria (uma linha por entidade, com indice) e o payload
-- guardado fica enxuto. Quem grava (o app) continua enviando o mesmo payload: um gatilho faz a separacao. As 3 funcoes que liam
-- entityValues passam a buscar a entidade pela chave. O resultado das funcoes e identico (verificado antes e depois).
-- Tudo numa transacao: ou entra por inteiro ou nada muda. Nenhum dado de metricas e tocado.

create table if not exists private.meta_dashboard_scope_entities (
  agency_id uuid not null,
  client_id uuid not null,
  scope_key text not null,
  date_from date not null,
  date_to date not null,
  entity_key text not null,
  entity_values jsonb not null,
  primary key (client_id, scope_key, date_from, date_to, entity_key)
);
alter table private.meta_dashboard_scope_entities enable row level security;
revoke all on private.meta_dashboard_scope_entities from public, anon, authenticated;

-- Separa entityValues do payload ao gravar (inclusao ou troca do payload).
create or replace function private.split_dashboard_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.payload -> 'entityValues') = 'object' then
    delete from private.meta_dashboard_scope_entities
      where client_id = new.client_id and scope_key = new.scope_key and date_from = new.date_from and date_to = new.date_to;
    insert into private.meta_dashboard_scope_entities (agency_id, client_id, scope_key, date_from, date_to, entity_key, entity_values)
      select new.agency_id, new.client_id, new.scope_key, new.date_from, new.date_to, e.key, e.value
      from jsonb_each(new.payload -> 'entityValues') e;
    new.payload := new.payload - 'entityValues';
  end if;
  return new;
end;
$$;
revoke all on function private.split_dashboard_scope() from public, anon, authenticated;

create or replace function private.drop_dashboard_scope_entities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.meta_dashboard_scope_entities
    where client_id = old.client_id and scope_key = old.scope_key and date_from = old.date_from and date_to = old.date_to;
  return old;
end;
$$;
revoke all on function private.drop_dashboard_scope_entities() from public, anon, authenticated;

drop trigger if exists split_dashboard_scope on public.meta_dashboard_scopes;
create trigger split_dashboard_scope before insert or update of payload on public.meta_dashboard_scopes
  for each row execute function private.split_dashboard_scope();
drop trigger if exists drop_dashboard_scope_entities on public.meta_dashboard_scopes;
create trigger drop_dashboard_scope_entities after delete on public.meta_dashboard_scopes
  for each row execute function private.drop_dashboard_scope_entities();

-- Resumos ja guardados: separa agora (o gatilho de update faz o trabalho).
update public.meta_dashboard_scopes set payload = payload where payload ? 'entityValues';

-- As funcoes sao reescritas a partir da definicao atual, trocando so o trecho que buscava em entityValues (todo o resto fica identico,
-- inclusive textos e ordem). Se o trecho esperado nao existir, a migracao falha e nada muda.
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- 1) valid_dashboard_scope: devolve tambem a chave do escopo (para achar as entidades).
  v_def := replace(pg_get_functiondef('private.valid_dashboard_scope(uuid,date,date,uuid[],text[])'::regprocedure), E'\r', '');
  v_old := 'select s.payload||jsonb_build_object(''_collectedAt'',s.collected_at)';
  v_new := 'select s.payload||jsonb_build_object(''_collectedAt'',s.collected_at,''_scopeKey'',s.scope_key)';
  if position(v_old in v_def) = 0 then raise exception 'valid_dashboard_scope: trecho esperado nao encontrado'; end if;
  execute replace(v_def, v_old, v_new);

  -- 2) enrich_dashboard_scope: valores das campanhas vem da tabela de entidades.
  v_def := replace(pg_get_functiondef('private.enrich_dashboard_scope(jsonb,uuid,date,date,uuid[],text[])'::regprocedure), E'\r', '');
  v_old := 'coalesce(v_payload->''entityValues''->((e->>''accountId'')||'':''||(e->>''key'')),''{}'')';
  v_new := 'coalesce((select se.entity_values from private.meta_dashboard_scope_entities se where se.client_id=p_client and se.scope_key=v_payload->>''_scopeKey'' and se.date_from=p_from and se.date_to=p_to and se.entity_key=((e->>''accountId'')||'':''||(e->>''key''))),''{}'')';
  if position(v_old in v_def) = 0 then raise exception 'enrich_dashboard_scope: trecho esperado nao encontrado'; end if;
  execute replace(v_def, v_old, v_new);

  -- 3) get_client_analytics_hierarchy: idem, para todas as entidades do catalogo.
  v_def := replace(pg_get_functiondef('public.get_client_analytics_hierarchy(uuid,date,date,uuid[])'::regprocedure), E'\r', '');
  v_new := 'coalesce((select se.entity_values from private.meta_dashboard_scope_entities se where se.client_id=p_client_id and se.scope_key=v_payload->>''_scopeKey'' and se.date_from=p_date_from and se.date_to=p_date_to and se.entity_key=((e->>''accountId'')||'':''||(e->>''key''))),''{}'')';
  if position(v_old in v_def) = 0 then raise exception 'get_client_analytics_hierarchy: trecho esperado nao encontrado'; end if;
  execute replace(v_def, v_old, v_new);
end
$$;
