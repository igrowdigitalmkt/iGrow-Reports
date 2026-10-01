-- Foundation for the authenticated Client Area. Client users are not agency members.
create table public.client_users (
  agency_id uuid not null,
  client_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agency_id, client_id, user_id),
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete restrict,
  constraint client_users_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);
create index client_users_user_active_idx
  on public.client_users(user_id, active, agency_id, client_id);

create function private.has_client_access(p_agency_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.client_users cu
    where cu.agency_id = p_agency_id and cu.client_id = p_client_id
      and cu.user_id = (select auth.uid()) and cu.active
  );
$$;
create function private.guard_client_user()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (
    new.agency_id <> old.agency_id or new.client_id <> old.client_id or new.user_id <> old.user_id
  ) then
    raise exception 'A identidade do vínculo da Área do Cliente é imutável.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger guard_client_user before update on public.client_users
for each row execute function private.guard_client_user();

alter table public.client_users enable row level security;
revoke all on table public.client_users from public, anon, authenticated;
grant select on public.client_users to authenticated;
grant all on public.client_users to service_role;

create policy client_users_read on public.client_users for select to authenticated
  using (
    private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[])
  );

-- Client users must not receive the administrative clients row because it contains
-- internal fields such as notes and created_by. Expose only the safe portal DTO.
create function public.list_client_portal_clients()
returns table(
  id uuid,
  agency_id uuid,
  name text,
  logo_path text,
  archived_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select c.id, c.agency_id, c.name, c.logo_path, c.archived_at
  from public.client_users cu
  join public.clients c on c.agency_id = cu.agency_id and c.id = cu.client_id
  where cu.user_id = (select auth.uid()) and cu.active
  order by c.name, c.id;
$$;

create function public.set_client_user_access(
  p_agency_id uuid,
  p_client_id uuid,
  p_user_id uuid,
  p_active boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_archived_at timestamptz;
  v_existing_active boolean;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para gerenciar a Área do Cliente.' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Estado de acesso inválido.' using errcode = '22023';
  end if;

  select archived_at into v_archived_at
  from public.clients
  where agency_id = p_agency_id and id = p_client_id
  for update;
  if not found then
    raise exception 'Cliente indisponível.' using errcode = '22023';
  end if;

  if p_active and v_archived_at is not null then
    raise exception 'Cliente arquivado não pode receber novo acesso.' using errcode = '22023';
  end if;
  if p_active and not exists(
    select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
  ) then
    raise exception 'Usuário autenticado e confirmado é obrigatório.' using errcode = '22023';
  end if;

  select active into v_existing_active from public.client_users
  where agency_id = p_agency_id and client_id = p_client_id and user_id = p_user_id
  for update;
  if p_active then
    if found then
      if v_existing_active then return; end if;
      update public.client_users set active = true
      where agency_id = p_agency_id and client_id = p_client_id and user_id = p_user_id;
    else
      insert into public.client_users(agency_id, client_id, user_id, active, created_by)
      values(p_agency_id, p_client_id, p_user_id, true, auth.uid());
    end if;
  else
    if not found then
      raise exception 'Vínculo da Área do Cliente indisponível.' using errcode = '22023';
    end if;
    if not v_existing_active then return; end if;
    update public.client_users set active = false
    where agency_id = p_agency_id and client_id = p_client_id and user_id = p_user_id;
  end if;

  insert into public.audit_logs(agency_id, actor_id, action, entity_id, metadata)
  values(
    p_agency_id,
    auth.uid(),
    case when p_active then 'client_user.granted' else 'client_user.revoked' end,
    p_client_id,
    jsonb_build_object('user_id', p_user_id)
  );
end;
$$;
revoke all on function private.has_client_access(uuid, uuid),
  private.guard_client_user() from public, anon, authenticated, service_role;
grant execute on function private.has_client_access(uuid, uuid) to authenticated;

revoke all on function public.list_client_portal_clients()
  from public, anon, authenticated, service_role;
grant execute on function public.list_client_portal_clients() to authenticated;

revoke all on function public.set_client_user_access(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_client_user_access(uuid, uuid, uuid, boolean)
  to authenticated;
