-- Meta Ads V1: each client owns one Meta connection, which may expose multiple ad accounts.
-- Ad accounts without a Meta Business Portfolio are intentionally unsupported.
-- This migration is intentionally idempotent because it was first applied through SQL Editor.

alter table public.meta_connections
  add column if not exists client_id uuid,
  add column if not exists label text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meta_connections_client_fkey'
      and conrelid = 'public.meta_connections'::regclass
  ) then
    alter table public.meta_connections
      add constraint meta_connections_client_fkey
      foreign key (agency_id, client_id)
      references public.clients(agency_id, id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'meta_connections_label_length'
      and conrelid = 'public.meta_connections'::regclass
  ) then
    alter table public.meta_connections
      add constraint meta_connections_label_length
      check (label is null or char_length(btrim(label)) between 1 and 120);
  end if;
end
$$;

alter table public.meta_connections
  drop constraint if exists meta_connections_agency_id_integration_id_key;

create unique index if not exists meta_connections_one_per_client_idx
  on public.meta_connections(agency_id, client_id)
  where client_id is not null;

create index if not exists meta_connections_client_idx
  on public.meta_connections(agency_id, client_id, created_at);

-- A provider account may only be linked to the client that owns its Meta connection.
create or replace function public.set_client_ad_account(
  p_agency_id uuid,
  p_client_id uuid,
  p_ad_account_id uuid,
  p_active boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_client_archived_at timestamptz;
  v_account_archived_at timestamptz;
  v_connection_client_id uuid;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin','editor']::public.agency_role[]
  ) then
    raise exception 'Sem permissao para associar contas de anuncio.' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Estado da associacao invalido.' using errcode = '22023';
  end if;

  select archived_at into v_client_archived_at
  from public.clients
  where agency_id = p_agency_id and id = p_client_id;
  if not found then
    raise exception 'Cliente indisponivel.' using errcode = '22023';
  end if;

  select a.archived_at, c.client_id
    into v_account_archived_at, v_connection_client_id
  from public.meta_ad_accounts a
  join public.meta_connections c
    on c.agency_id = a.agency_id and c.id = a.meta_connection_id
  where a.agency_id = p_agency_id and a.id = p_ad_account_id;
  if not found then
    raise exception 'Conta de anuncio indisponivel.' using errcode = '22023';
  end if;

  if p_active and v_connection_client_id is distinct from p_client_id then
    raise exception 'A conta de anuncio pertence a outra conexao de cliente.' using errcode = '22023';
  end if;

  if p_active and (v_client_archived_at is not null or v_account_archived_at is not null) then
    raise exception 'Cliente ou conta arquivada nao pode receber nova associacao.' using errcode = '22023';
  end if;

  insert into public.client_ad_accounts(
    agency_id, client_id, ad_account_id, active, created_by
  ) values (
    p_agency_id, p_client_id, p_ad_account_id, p_active, auth.uid()
  )
  on conflict (agency_id, client_id, ad_account_id)
  do update set active = excluded.active;

  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
  values(
    p_agency_id,
    auth.uid(),
    case when p_active then 'client_ad_account.linked' else 'client_ad_account.unlinked' end,
    p_client_id,
    jsonb_build_object('ad_account_id', p_ad_account_id)
  );
end;
$$;

-- Existing agency-level rows are intentionally left unassigned. New connections
-- created by the application always carry client_id.
