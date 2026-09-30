-- iGrow Reports: instalar UMA VEZ em projeto Supabase novo.

-- Se houver erro, a transacao inteira sera revertida. Nao executar testes neste editor.

begin;

-- Migration: 202609300001_foundation.sql

-- Foundation only. No production fixtures, public registration or integration secrets.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create type public.agency_role as enum ('owner', 'admin', 'editor', 'viewer');

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  timezone text not null default 'America/Sao_Paulo',
  logo_path text,
  membership_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agency_users (
  agency_id uuid not null references public.agencies(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.agency_role not null,
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);
create index agency_users_user_idx on public.agency_users(user_id, agency_id);

create table public.agency_invitations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and email like '%@%'),
  role public.agency_role not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by uuid,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agency_invitations_inviter_fkey foreign key (agency_id, invited_by)
    references public.agency_users(agency_id, user_id) on delete set null (invited_by),
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null))
);
create index agency_invitations_agency_idx on public.agency_invitations(agency_id, created_at desc);
create unique index agency_invitations_pending_idx on public.agency_invitations(agency_id, email)
  where accepted_at is null and revoked_at is null;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  logo_path text,
  notes text check (char_length(notes) <= 10000),
  archived_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  constraint clients_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);
create index clients_agency_active_idx on public.clients(agency_id, archived_at, name);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_agency_created_idx on public.audit_logs(agency_id, created_at desc);

-- Helpers are outside the exposed API schema. The caller identity comes from Auth.
create function private.agency_role(p_agency_id uuid)
returns public.agency_role language sql stable security definer set search_path = '' as $$
  select au.role from public.agency_users au
  where au.agency_id = p_agency_id and au.user_id = (select auth.uid());
$$;
create function private.has_agency_role(p_agency_id uuid, p_roles public.agency_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.agency_role(p_agency_id) = any(p_roles), false);
$$;

create function private.validate_agency()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger validate_agency before insert or update on public.agencies
for each row execute function private.validate_agency();

create function private.touch_client()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.agency_id <> old.agency_id then
    raise exception 'Não é permitido transferir registros entre agências.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_client before update on public.clients
for each row execute function private.touch_client();

-- Every membership mutation writes the same parent row. This serializes owner changes
-- and aborts stale repeatable-read transactions instead of losing the last owner.
create function private.guard_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_agency_id uuid;
begin
  if tg_op = 'UPDATE' and (new.agency_id <> old.agency_id or new.user_id <> old.user_id) then
    raise exception 'A identidade da associação é imutável.' using errcode = '42501';
  end if;
  v_agency_id := case when tg_op = 'DELETE' then old.agency_id else new.agency_id end;
  update public.agencies set membership_version = membership_version + 1 where id = v_agency_id;
  if tg_op <> 'INSERT' and old.role = 'owner' then
    if tg_op = 'DELETE' or new.role <> 'owner' then
      if not exists (select 1 from public.agency_users
        where agency_id = old.agency_id and user_id <> old.user_id and role = 'owner') then
        raise exception 'A agência precisa manter pelo menos um proprietário.' using errcode = '23514';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_membership before insert or update or delete on public.agency_users
for each row execute function private.guard_membership();

alter table public.agencies enable row level security;
alter table public.agency_users enable row level security;
alter table public.agency_invitations enable row level security;
alter table public.clients enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table public.agencies, public.agency_users, public.agency_invitations,
  public.clients, public.audit_logs from public, anon, authenticated;
grant select on public.agencies, public.agency_users, public.clients, public.audit_logs to authenticated;
grant update (name, timezone, logo_path) on public.agencies to authenticated;
grant select (id, agency_id, email, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at)
  on public.agency_invitations to authenticated;
grant insert (agency_id, name, logo_path, notes) on public.clients to authenticated;
grant update (name, logo_path, notes, archived_at) on public.clients to authenticated;
grant all on public.agencies, public.agency_users, public.agency_invitations, public.clients, public.audit_logs to service_role;

create policy agencies_read on public.agencies for select to authenticated
  using (private.agency_role(id) is not null);
create policy agencies_update on public.agencies for update to authenticated
  using (private.has_agency_role(id, array['owner','admin']::public.agency_role[]))
  with check (private.has_agency_role(id, array['owner','admin']::public.agency_role[]));
create policy agency_users_read on public.agency_users for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy invitations_read on public.agency_invitations for select to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));
create policy clients_read on public.clients for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy clients_insert on public.clients for insert to authenticated
  with check (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
create policy clients_update on public.clients for update to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]))
  with check (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));

create function public.set_agency_member_role(p_agency_id uuid, p_user_id uuid, p_role public.agency_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor_role public.agency_role; v_target_role public.agency_role;
begin
  perform 1 from public.agencies where id = p_agency_id for update;
  v_actor_role := private.agency_role(p_agency_id);
  select role into v_target_role from public.agency_users where agency_id = p_agency_id and user_id = p_user_id;
  if v_actor_role is null or v_actor_role not in ('owner','admin') or v_target_role is null or p_role is null then
    raise exception 'Sem permissão para alterar esta associação.' using errcode = '42501';
  end if;
  if v_actor_role = 'admin' and (v_target_role = 'owner' or p_role = 'owner') then
    raise exception 'Somente proprietários gerenciam proprietários.' using errcode = '42501';
  end if;
  update public.agency_users set role = p_role where agency_id = p_agency_id and user_id = p_user_id;
  insert into public.audit_logs(agency_id, actor_id, action, entity_id, metadata)
    values(p_agency_id, auth.uid(), 'membership.role_changed', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

create function public.remove_agency_member(p_agency_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor_role public.agency_role; v_target_role public.agency_role;
begin
  perform 1 from public.agencies where id = p_agency_id for update;
  v_actor_role := private.agency_role(p_agency_id);
  select role into v_target_role from public.agency_users where agency_id = p_agency_id and user_id = p_user_id;
  if v_actor_role is null or v_actor_role not in ('owner','admin') or v_target_role is null then
    raise exception 'Sem permissão para remover esta associação.' using errcode = '42501';
  end if;
  if v_actor_role = 'admin' and v_target_role = 'owner' then
    raise exception 'Somente proprietários gerenciam proprietários.' using errcode = '42501';
  end if;
  delete from public.agency_users where agency_id = p_agency_id and user_id = p_user_id;
  insert into public.audit_logs(agency_id, actor_id, action, entity_id)
    values(p_agency_id, auth.uid(), 'membership.removed', p_user_id);
end;
$$;

create function public.issue_agency_invitation(
  p_agency_id uuid, p_email text, p_role public.agency_role, p_expires_in_hours integer default 72
)
returns table(invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_actor_role public.agency_role; v_token text; v_id uuid; v_expires_at timestamptz;
begin
  perform 1 from public.agencies where id = p_agency_id for update;
  v_actor_role := private.agency_role(p_agency_id);
  if v_actor_role is null or v_actor_role not in ('owner','admin') or p_role is null
    or (v_actor_role = 'admin' and p_role = 'owner') then
    raise exception 'Sem permissão para emitir este convite.' using errcode = '42501';
  end if;
  if p_expires_in_hours is null or p_expires_in_hours not between 1 and 168
    or p_email is null or char_length(btrim(p_email)) not between 3 and 254 or p_email not like '%@%' then
    raise exception 'Email ou prazo do convite inválido.' using errcode = '22023';
  end if;
  if v_actor_role = 'admin' and exists (
    select 1 from public.agency_invitations where agency_id = p_agency_id
      and email = lower(btrim(p_email)) and role = 'owner' and accepted_at is null and revoked_at is null
  ) then
    raise exception 'Somente proprietários substituem convites de proprietário.' using errcode = '42501';
  end if;
  -- Two cryptographically random UUIDv4 values provide 244 random bits; only the hash persists.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires_at := now() + make_interval(hours => p_expires_in_hours);
  update public.agency_invitations set revoked_at = now()
    where agency_id = p_agency_id and email = lower(btrim(p_email)) and accepted_at is null and revoked_at is null;
  insert into public.agency_invitations(agency_id,email,role,token_hash,invited_by,expires_at)
    values(p_agency_id,lower(btrim(p_email)),p_role,encode(sha256(convert_to(v_token,'UTF8')),'hex'),auth.uid(),v_expires_at)
    returning id into v_id;
  insert into public.audit_logs(agency_id,actor_id,action,entity_id)
    values(p_agency_id,auth.uid(),'invitation.issued',v_id);
  return query select v_id,v_token,v_expires_at;
end;
$$;

create function public.revoke_agency_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_agency_id uuid; v_invite_role public.agency_role; v_actor_role public.agency_role;
begin
  select agency_id into v_agency_id from public.agency_invitations where id = p_invitation_id;
  perform 1 from public.agencies where id = v_agency_id for update;
  select role into v_invite_role from public.agency_invitations where id = p_invitation_id;
  v_actor_role := private.agency_role(v_agency_id);
  if v_actor_role is null or v_actor_role not in ('owner','admin')
    or (v_actor_role = 'admin' and v_invite_role = 'owner') then
    raise exception 'Sem permissão para revogar este convite.' using errcode = '42501';
  end if;
  update public.agency_invitations set revoked_at = now()
    where id = p_invitation_id and accepted_at is null and revoked_at is null;
  insert into public.audit_logs(agency_id,actor_id,action,entity_id)
    values(v_agency_id,auth.uid(),'invitation.revoked',p_invitation_id);
end;
$$;

create function public.accept_agency_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_email text; v_agency_id uuid; v_invite public.agency_invitations%rowtype; v_inviter_role public.agency_role;
begin
  v_uid := auth.uid();
  if v_uid is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Convite inválido ou indisponível.' using errcode = '22023';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  select agency_id into v_agency_id from public.agency_invitations
    where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex');
  -- Same lock order as issuing/revoking/team changes, then re-read the invitation.
  perform 1 from public.agencies where id = v_agency_id for update;
  select * into v_invite from public.agency_invitations
    where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or v_email is null or v_invite.email <> v_email or v_invite.expires_at <= now()
    or v_invite.accepted_at is not null or v_invite.revoked_at is not null then
    raise exception 'Convite inválido ou indisponível.' using errcode = '22023';
  end if;
  select role into v_inviter_role from public.agency_users
    where agency_id = v_agency_id and user_id = v_invite.invited_by;
  if v_inviter_role is null or v_inviter_role not in ('owner','admin')
    or (v_inviter_role = 'admin' and v_invite.role = 'owner') then
    raise exception 'Convite inválido ou indisponível.' using errcode = '22023';
  end if;
  -- Existing members keep their current role; invitations are never a promotion path.
  insert into public.agency_users(agency_id,user_id,role) values(v_agency_id,v_uid,v_invite.role)
    on conflict (agency_id,user_id) do nothing;
  update public.agency_invitations set accepted_at = now(), accepted_by = v_uid where id = v_invite.id;
  insert into public.audit_logs(agency_id,actor_id,action,entity_id)
    values(v_agency_id,v_uid,'invitation.accepted',v_invite.id);
  return v_agency_id;
end;
$$;

-- Operator-only bootstrap. Not exposed through PostgREST or granted to service_role.
create function private.bootstrap_agency(p_owner_email text, p_name text, p_timezone text default 'America/Sao_Paulo')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner_id uuid; v_agency_id uuid;
begin
  select id into v_owner_id from auth.users where lower(email) = lower(btrim(p_owner_email)) and email_confirmed_at is not null;
  if v_owner_id is null then
    raise exception 'Crie e confirme a conta do proprietário no Supabase Auth antes do bootstrap.' using errcode = '22023';
  end if;
  insert into public.agencies(name,timezone) values(btrim(p_name),p_timezone) returning id into v_agency_id;
  insert into public.agency_users(agency_id,user_id,role) values(v_agency_id,v_owner_id,'owner');
  insert into public.audit_logs(agency_id,actor_id,action,entity_id)
    values(v_agency_id,v_owner_id,'agency.bootstrapped',v_agency_id);
  return v_agency_id;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.agency_role(uuid), private.has_agency_role(uuid,public.agency_role[]) to authenticated;
revoke all on function public.set_agency_member_role(uuid,uuid,public.agency_role),
  public.remove_agency_member(uuid,uuid), public.issue_agency_invitation(uuid,text,public.agency_role,integer),
  public.revoke_agency_invitation(uuid), public.accept_agency_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.set_agency_member_role(uuid,uuid,public.agency_role),
  public.remove_agency_member(uuid,uuid), public.issue_agency_invitation(uuid,text,public.agency_role,integer),
  public.revoke_agency_invitation(uuid), public.accept_agency_invitation(text) to authenticated;


-- Migration: 202609300002_private_storage.sql

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('agency-assets','agency-assets',false,5242880,array['image/png','image/jpeg','image/webp']),
  ('client-assets','client-assets',false,5242880,array['image/png','image/jpeg','image/webp']),
  ('report-assets','report-assets',false,20971520,array['image/png','image/jpeg','image/webp']),
  ('report-pdfs','report-pdfs',false,20971520,array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Paths: agency-assets/<agency UUID>/<file>; client-assets/<agency UUID>/<client UUID>/<file>.
-- report-* are reserved for future jobs; clients receive no direct write policy.
create function private.can_access_asset(p_bucket text, p_name text, p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_agency_id uuid; v_client_id uuid; v_role public.agency_role;
begin
  if p_bucket not in ('agency-assets','client-assets','report-assets','report-pdfs') then return false; end if;
  if p_name is null or p_name like '%..%' or split_part(p_name,'/',2) = '' then return false; end if;
  begin
    v_agency_id := split_part(p_name,'/',1)::uuid;
  exception when invalid_text_representation then return false;
  end;
  v_role := private.agency_role(v_agency_id);
  if v_role is null then return false; end if;
  if p_bucket = 'client-assets' then
    begin
      v_client_id := split_part(p_name,'/',2)::uuid;
    exception when invalid_text_representation then return false;
    end;
    if split_part(p_name,'/',3) = '' or not exists (
      select 1 from public.clients where agency_id = v_agency_id and id = v_client_id
    ) then return false; end if;
  end if;
  if not p_write then return true; end if;
  if p_bucket = 'agency-assets' then return v_role in ('owner','admin'); end if;
  if p_bucket = 'client-assets' then return v_role in ('owner','admin','editor'); end if;
  return false;
end;
$$;
revoke all on function private.can_access_asset(text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function private.can_access_asset(text,text,boolean) to authenticated;

create policy igrow_assets_read on storage.objects for select to authenticated
  using (private.can_access_asset(bucket_id,name,false));
create policy igrow_assets_insert on storage.objects for insert to authenticated
  with check (private.can_access_asset(bucket_id,name,true));
create policy igrow_assets_update on storage.objects for update to authenticated
  using (private.can_access_asset(bucket_id,name,true))
  with check (private.can_access_asset(bucket_id,name,true));
create policy igrow_assets_delete on storage.objects for delete to authenticated
  using (private.can_access_asset(bucket_id,name,true));


-- Migration: 202609300003_client_audit.sql

-- Audit in the same transaction as the mutation. Never store notes or names in logs.
create function private.audit_client_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then v_action := 'client.created';
  elsif old.archived_at is distinct from new.archived_at then
    v_action := case when new.archived_at is null then 'client.reactivated' else 'client.archived' end;
  elsif old.name is distinct from new.name or old.notes is distinct from new.notes or old.logo_path is distinct from new.logo_path then
    v_action := 'client.updated';
  else return new;
  end if;
  insert into public.audit_logs(agency_id,actor_id,action,entity_id)
    values(new.agency_id,auth.uid(),v_action,new.id);
  return new;
end;
$$;
revoke all on function private.audit_client_change() from public,anon,authenticated,service_role;
create trigger audit_client_change after insert or update on public.clients
for each row execute function private.audit_client_change();


-- Migration: 202609300004_recipients.sql

create table public.client_recipients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  active boolean not null default true,
  consent_status text not null default 'pending' check (consent_status in ('pending','granted','revoked')),
  consent_at timestamptz,
  consent_source text,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id,client_id) references public.clients(agency_id,id) on delete restrict,
  unique (agency_id,client_id,phone),
  unique (agency_id,client_id,id),
  check (consent_status <> 'granted' or (consent_at is not null and consent_source is not null and unsubscribed_at is null))
);
create index recipients_client_idx on public.client_recipients(agency_id,client_id,id);
create table public.recipient_consent_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  recipient_id uuid not null,
  event_type text not null check (event_type in ('created','updated','phone_changed','activated','deactivated','granted','revoked')),
  phone text not null,
  source text not null check (char_length(source) between 2 and 1000),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  foreign key (agency_id,client_id,recipient_id) references public.client_recipients(agency_id,client_id,id) on delete restrict
);
create index consent_events_recipient_idx on public.recipient_consent_events(agency_id,client_id,recipient_id,recorded_at);
alter table public.client_recipients enable row level security;
alter table public.recipient_consent_events enable row level security;
revoke all on public.client_recipients, public.recipient_consent_events from public,anon,authenticated;
grant select on public.client_recipients, public.recipient_consent_events to authenticated;
grant all on public.client_recipients, public.recipient_consent_events to service_role;
create policy recipients_read on public.client_recipients for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy consent_events_read on public.recipient_consent_events for select to authenticated
  using (private.agency_role(agency_id) is not null);

create function public.save_client_recipient(p_agency_id uuid,p_client_id uuid,p_id uuid,p_name text,p_phone text,p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_old public.client_recipients; v_id uuid; v_event text;
begin
  if not private.has_agency_role(p_agency_id,array['owner','admin','editor']::public.agency_role[]) then
    raise exception 'Sem permissão.' using errcode='42501';
  end if;
  perform 1 from public.clients where agency_id=p_agency_id and id=p_client_id and archived_at is null for update;
  if not found then raise exception 'Cliente indisponível.' using errcode='22023'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' or p_active is null then
    raise exception 'Dados inválidos.' using errcode='22023';
  end if;
  if p_id is null then
    insert into public.client_recipients(agency_id,client_id,name,phone,active)
      values(p_agency_id,p_client_id,btrim(p_name),p_phone,p_active) returning id into v_id;
    v_event := 'created';
  else
    select * into v_old from public.client_recipients where agency_id=p_agency_id and client_id=p_client_id and id=p_id for update;
    if not found then raise exception 'Destinatário indisponível.' using errcode='22023'; end if;
    v_id := p_id;
    if v_old.name=btrim(p_name) and v_old.phone=p_phone and v_old.active=p_active then return v_id; end if;
    v_event := case when v_old.phone<>p_phone then 'phone_changed' when v_old.active<>p_active then
      case when p_active then 'activated' else 'deactivated' end else 'updated' end;
    update public.client_recipients set name=btrim(p_name),phone=p_phone,active=p_active,updated_at=now(),
      consent_status=case when v_old.phone<>p_phone then 'pending' else consent_status end,
      consent_at=case when v_old.phone<>p_phone then null else consent_at end,
      consent_source=case when v_old.phone<>p_phone then null else consent_source end,
      unsubscribed_at=case when v_old.phone<>p_phone then null else unsubscribed_at end
      where id=v_id;
  end if;
  insert into public.recipient_consent_events(agency_id,client_id,recipient_id,event_type,phone,source,occurred_at,actor_id)
    values(p_agency_id,p_client_id,v_id,v_event,p_phone,'Cadastro administrativo',now(),auth.uid());
  insert into public.audit_logs(agency_id,actor_id,action,entity_id) values(p_agency_id,auth.uid(),'recipient.'||v_event,v_id);
  return v_id;
end;
$$;

create function public.set_recipient_consent(p_agency_id uuid,p_client_id uuid,p_recipient_id uuid,p_phone text,p_granted boolean,p_source text,p_occurred_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_recipient public.client_recipients; v_archived timestamptz; v_time timestamptz;
begin
  if not private.has_agency_role(p_agency_id,array['owner','admin','editor']::public.agency_role[]) then
    raise exception 'Sem permissão.' using errcode='42501';
  end if;
  select archived_at into v_archived from public.clients where agency_id=p_agency_id and id=p_client_id for update;
  if not found then raise exception 'Cliente indisponível.' using errcode='22023'; end if;
  select * into v_recipient from public.client_recipients where agency_id=p_agency_id and client_id=p_client_id and id=p_recipient_id for update;
  if not found or p_phone is distinct from v_recipient.phone then raise exception 'Destinatário alterado. Atualize a página.' using errcode='22023'; end if;
  if p_granted is null or p_source is null or char_length(btrim(p_source)) not between 2 and 1000 then
    raise exception 'Informe a origem do registro.' using errcode='22023';
  end if;
  if p_granted and (v_archived is not null or not v_recipient.active or p_occurred_at is null or p_occurred_at>now() or p_occurred_at<'2000-01-01'::timestamptz) then
    raise exception 'Autorização inválida ou destinatário inativo.' using errcode='22023';
  end if;
  -- A later opt-in needs new evidence, not reuse of evidence preceding the opt-out.
  if p_granted and v_recipient.unsubscribed_at is not null and p_occurred_at<=v_recipient.unsubscribed_at then
    raise exception 'A nova autorização deve ser posterior ao descadastro.' using errcode='22023';
  end if;
  if p_granted and exists(select 1 from public.recipient_consent_events where recipient_id=v_recipient.id and phone=p_phone and event_type='revoked' and occurred_at>=p_occurred_at) then
    raise exception 'A autorização deve ser posterior ao descadastro deste telefone.' using errcode='22023';
  end if;
  if (p_granted and v_recipient.consent_status='granted') or (not p_granted and v_recipient.consent_status='revoked') then return v_recipient.id; end if;
  v_time := case when p_granted then p_occurred_at else now() end;
  update public.client_recipients set
    consent_status=case when p_granted then 'granted' else 'revoked' end,
    consent_at=case when p_granted then v_time else consent_at end,
    consent_source=case when p_granted then btrim(p_source) else consent_source end,
    unsubscribed_at=case when p_granted then null else v_time end,updated_at=now()
    where id=v_recipient.id;
  insert into public.recipient_consent_events(agency_id,client_id,recipient_id,event_type,phone,source,occurred_at,actor_id)
    values(p_agency_id,p_client_id,v_recipient.id,case when p_granted then 'granted' else 'revoked' end,p_phone,btrim(p_source),v_time,auth.uid());
  insert into public.audit_logs(agency_id,actor_id,action,entity_id)
    values(p_agency_id,auth.uid(),case when p_granted then 'recipient.granted' else 'recipient.revoked' end,v_recipient.id);
  return v_recipient.id;
end;
$$;
revoke all on function public.save_client_recipient(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.set_recipient_consent(uuid,uuid,uuid,text,boolean,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_client_recipient(uuid,uuid,uuid,text,text,boolean) to authenticated;
grant execute on function public.set_recipient_consent(uuid,uuid,uuid,text,boolean,text,timestamptz) to authenticated;


commit;

select 'Instalacao iGrow concluida' as resultado;
