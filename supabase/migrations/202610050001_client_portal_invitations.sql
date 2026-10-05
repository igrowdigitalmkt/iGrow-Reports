-- Client portal invitations: an invitation is the grant. It becomes an active
-- client_users link when the invited, confirmed account signs in (account
-- created from the invite, or an existing account following the emailed link).
create table public.client_portal_invitations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and email like '%_@_%'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete restrict,
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);
create unique index client_portal_invitations_pending_idx
  on public.client_portal_invitations(agency_id, client_id, email)
  where accepted_at is null and revoked_at is null;
create index client_portal_invitations_email_idx
  on public.client_portal_invitations(email)
  where accepted_at is null and revoked_at is null;

alter table public.client_portal_invitations enable row level security;
revoke all on table public.client_portal_invitations from public, anon, authenticated;
grant all on table public.client_portal_invitations to service_role;

-- Registers (or replaces) the pending invitation. The application sends the
-- email afterwards: an account invite when no confirmed account exists, or a
-- sign-in link when it does.
create function public.invite_client_portal_user(p_agency_id uuid, p_client_id uuid, p_email text)
returns table(invitation_id uuid, existing_account boolean, already_active boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_archived_at timestamptz;
  v_user_id uuid;
  v_id uuid;
begin
  if not private.has_agency_role(p_agency_id, array['owner','admin']::public.agency_role[]) then
    raise exception 'Sem permissão para gerenciar a Área do Cliente.' using errcode = '42501';
  end if;
  if char_length(v_email) not between 3 and 254 or v_email not like '%_@_%' then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;

  select archived_at into v_archived_at from public.clients
  where agency_id = p_agency_id and id = p_client_id for update;
  if not found or v_archived_at is not null then
    raise exception 'Cliente indisponível.' using errcode = '22023';
  end if;

  select id into v_user_id from auth.users
  where lower(email) = v_email and email_confirmed_at is not null;

  if v_user_id is not null and exists(
    select 1 from public.client_users
    where agency_id = p_agency_id and client_id = p_client_id and user_id = v_user_id and active
  ) then
    return query select null::uuid, true, true;
    return;
  end if;

  update public.client_portal_invitations set revoked_at = now()
  where agency_id = p_agency_id and client_id = p_client_id and email = v_email
    and accepted_at is null and revoked_at is null;

  insert into public.client_portal_invitations(agency_id, client_id, email, invited_by, expires_at)
  values (p_agency_id, p_client_id, v_email, auth.uid(), now() + interval '7 days')
  returning id into v_id;

  insert into public.audit_logs(agency_id, actor_id, action, entity_id, metadata)
  values (p_agency_id, auth.uid(), 'client_portal.invited', p_client_id,
    jsonb_build_object('invitation_id', v_id, 'existing_account', v_user_id is not null));

  return query select v_id, v_user_id is not null, false;
end;
$$;

-- Accepts every valid pending invitation for the caller's confirmed email.
create function public.accept_client_portal_invitations()
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invitation record;
begin
  if v_uid is null then return; end if;
  select lower(email) into v_email from auth.users
  where id = v_uid and email_confirmed_at is not null;
  if v_email is null then return; end if;

  for v_invitation in
    select i.id, i.agency_id, i.client_id, i.invited_by
    from public.client_portal_invitations i
    join public.clients c on c.agency_id = i.agency_id and c.id = i.client_id
    where i.email = v_email and i.accepted_at is null and i.revoked_at is null
      and i.expires_at > now() and c.archived_at is null
    for update of i
  loop
    insert into public.client_users(agency_id, client_id, user_id, active, created_by)
    values (v_invitation.agency_id, v_invitation.client_id, v_uid, true,
      (select au.user_id from public.agency_users au
       where au.agency_id = v_invitation.agency_id and au.user_id = v_invitation.invited_by))
    on conflict (agency_id, client_id, user_id) do update set active = true;

    update public.client_portal_invitations set accepted_at = now(), accepted_by = v_uid
    where id = v_invitation.id;

    insert into public.audit_logs(agency_id, actor_id, action, entity_id, metadata)
    values (v_invitation.agency_id, v_uid, 'client_user.granted', v_invitation.client_id,
      jsonb_build_object('user_id', v_uid, 'invitation_id', v_invitation.id, 'invited_by', v_invitation.invited_by));

    return next v_invitation.client_id;
  end loop;
end;
$$;

create function public.revoke_client_portal_invitation(p_agency_id uuid, p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_agency_role(p_agency_id, array['owner','admin']::public.agency_role[]) then
    raise exception 'Sem permissão para gerenciar a Área do Cliente.' using errcode = '42501';
  end if;
  update public.client_portal_invitations set revoked_at = now()
  where agency_id = p_agency_id and id = p_invitation_id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'Convite indisponível.' using errcode = '22023';
  end if;
  insert into public.audit_logs(agency_id, actor_id, action, entity_id, metadata)
  values (p_agency_id, auth.uid(), 'client_portal.invitation_revoked', p_invitation_id, '{}'::jsonb);
end;
$$;

create function public.list_client_portal_invitations(p_agency_id uuid)
returns table(id uuid, client_id uuid, email text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_agency_role(p_agency_id, array['owner','admin']::public.agency_role[]) then
    raise exception 'Sem permissão para gerenciar a Área do Cliente.' using errcode = '42501';
  end if;
  return query
    select i.id, i.client_id, i.email, i.created_at, i.expires_at
    from public.client_portal_invitations i
    where i.agency_id = p_agency_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    order by i.email;
end;
$$;

revoke all on function public.invite_client_portal_user(uuid, uuid, text),
  public.accept_client_portal_invitations(),
  public.revoke_client_portal_invitation(uuid, uuid),
  public.list_client_portal_invitations(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.invite_client_portal_user(uuid, uuid, text),
  public.accept_client_portal_invitations(),
  public.revoke_client_portal_invitation(uuid, uuid),
  public.list_client_portal_invitations(uuid)
  to authenticated;
