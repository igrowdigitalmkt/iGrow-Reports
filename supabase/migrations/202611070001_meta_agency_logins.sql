-- Meta: uma conexão por conta empresarial (login) da agência; os clientes só escolhem os ativos deles.
-- Aditiva e idempotente. A linha de conexão do cliente continua existindo (as ligações de coleta, agente e faturamento não mudam);
-- ela apenas passa a apontar para o login da agência que guarda o token. Logins da agência são linhas com client_id nulo.

alter table public.meta_connections
  add column if not exists source_connection_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meta_connections_source_fkey'
      and conrelid = 'public.meta_connections'::regclass
  ) then
    alter table public.meta_connections
      add constraint meta_connections_source_fkey
      foreign key (agency_id, source_connection_id)
      references public.meta_connections(agency_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'meta_connections_source_shape'
      and conrelid = 'public.meta_connections'::regclass
  ) then
    alter table public.meta_connections
      add constraint meta_connections_source_shape
      check (source_connection_id is null or (client_id is not null and source_connection_id <> id));
  end if;
end
$$;

create index if not exists meta_connections_source_idx
  on public.meta_connections(agency_id, source_connection_id)
  where source_connection_id is not null;

-- Um mesmo usuário do Facebook não gera dois logins da agência.
create unique index if not exists meta_connections_agency_login_user_idx
  on public.meta_connections(agency_id, integration_id, external_user_id)
  where client_id is null and external_user_id is not null;
