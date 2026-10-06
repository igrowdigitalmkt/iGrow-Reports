-- Team management: members with name and e-mail, pending invitations and the modules each
-- member can open. Owners and administrators always see everything.
create table public.agency_member_permissions (
  agency_id uuid not null,
  user_id uuid not null,
  modules text[] not null check (modules <@ array['visao_geral','clientes','relatorios','agendamentos','integracoes']::text[]),
  updated_at timestamptz not null default now(),
  primary key (agency_id, user_id),
  foreign key (agency_id, user_id) references public.agency_users(agency_id, user_id) on delete cascade
);
alter table public.agency_member_permissions enable row level security;
revoke all on public.agency_member_permissions from public, anon, authenticated;
grant select on public.agency_member_permissions to authenticated;
grant all on public.agency_member_permissions to service_role;
-- Each person reads their own restrictions; owners and administrators read everyone's.
create policy member_permissions_read on public.agency_member_permissions for select to authenticated
  using (user_id = auth.uid() or private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));

create function public.list_agency_members(p_agency_id uuid)
returns table(user_id uuid, email text, full_name text, avatar_url text, role public.agency_role, joined_at timestamptz, last_sign_in_at timestamptz, modules text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.agency_role(p_agency_id) is null then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return query
    select au.user_id, u.email::text, nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
      au.role, au.created_at, u.last_sign_in_at, p.modules
    from public.agency_users au
    join auth.users u on u.id = au.user_id
    left join public.agency_member_permissions p on p.agency_id = au.agency_id and p.user_id = au.user_id
    where au.agency_id = p_agency_id
    order by case au.role when 'owner' then 0 when 'admin' then 1 when 'editor' then 2 else 3 end, u.email;
end $$;

create function public.list_agency_invitations(p_agency_id uuid)
returns table(id uuid, email text, role public.agency_role, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_agency_role(p_agency_id, array['owner','admin']::public.agency_role[]) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return query select i.id, i.email, i.role, i.created_at, i.expires_at from public.agency_invitations i
    where i.agency_id = p_agency_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    order by i.created_at desc;
end $$;

-- null modules = full access. Owners and administrators cannot be restricted.
create function public.set_agency_member_modules(p_agency_id uuid, p_user_id uuid, p_modules text[])
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_target public.agency_role;
begin
  if not private.has_agency_role(p_agency_id, array['owner','admin']::public.agency_role[]) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select role into v_target from public.agency_users where agency_id = p_agency_id and user_id = p_user_id;
  if v_target is null then raise exception 'Membro não encontrado.' using errcode = '22023'; end if;
  if v_target in ('owner','admin') then raise exception 'Proprietários e administradores têm acesso a tudo.' using errcode = '22023'; end if;
  if p_modules is null then
    delete from public.agency_member_permissions where agency_id = p_agency_id and user_id = p_user_id;
  else
    insert into public.agency_member_permissions(agency_id, user_id, modules) values (p_agency_id, p_user_id, p_modules)
      on conflict (agency_id, user_id) do update set modules = excluded.modules, updated_at = now();
  end if;
  insert into public.audit_logs(agency_id, actor_id, action, entity_id, metadata)
    values (p_agency_id, auth.uid(), 'membership.modules_changed', p_user_id, jsonb_build_object('modules', p_modules));
end $$;

revoke all on function public.list_agency_members(uuid), public.list_agency_invitations(uuid), public.set_agency_member_modules(uuid, uuid, text[]) from public, anon;
grant execute on function public.list_agency_members(uuid), public.list_agency_invitations(uuid), public.set_agency_member_modules(uuid, uuid, text[]) to authenticated;

-- Invitations by e-mail are accepted when the invited person signs in with that confirmed e-mail,
-- so the e-mail link works for new and existing accounts alike. Same rules as accepting by token.
create function public.accept_pending_agency_invitations()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_invite public.agency_invitations%rowtype; v_inviter public.agency_role; v_count integer := 0;
begin
  if v_uid is null then return 0; end if;
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for v_invite in
    select * from public.agency_invitations
    where email = v_email and accepted_at is null and revoked_at is null and expires_at > now()
    order by created_at for update
  loop
    perform 1 from public.agencies where id = v_invite.agency_id for update;
    select role into v_inviter from public.agency_users where agency_id = v_invite.agency_id and user_id = v_invite.invited_by;
    continue when v_inviter is null or v_inviter not in ('owner','admin') or (v_inviter = 'admin' and v_invite.role = 'owner');
    insert into public.agency_users(agency_id, user_id, role) values (v_invite.agency_id, v_uid, v_invite.role)
      on conflict (agency_id, user_id) do nothing;
    update public.agency_invitations set accepted_at = now(), accepted_by = v_uid where id = v_invite.id;
    insert into public.audit_logs(agency_id, actor_id, action, entity_id) values (v_invite.agency_id, v_uid, 'invitation.accepted', v_invite.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.accept_pending_agency_invitations() from public, anon;
grant execute on function public.accept_pending_agency_invitations() to authenticated;
