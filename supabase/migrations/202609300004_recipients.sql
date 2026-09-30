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
