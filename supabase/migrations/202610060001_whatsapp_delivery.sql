-- WhatsApp Cloud API: one sending number per workspace, report deliveries per recipient
-- and the raw webhook events that move each delivery from accepted to sent/delivered/read.

create table public.whatsapp_connections (
  agency_id uuid primary key references public.agencies(id) on delete restrict,
  integration_id uuid not null,
  waba_id text not null check (waba_id ~ '^[0-9]{5,30}$'),
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone text check (char_length(display_phone) <= 40),
  verified_name text check (char_length(verified_name) <= 200),
  quality_rating text check (char_length(quality_rating) <= 40),
  template_name text check (template_name ~ '^[a-z0-9_]{1,512}$'),
  template_language text check (template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  template_status text check (char_length(template_status) <= 40),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id, integration_id) references public.integrations(agency_id, id) on delete restrict
);

create table public.report_deliveries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  recipient_id uuid not null,
  report_version_id uuid not null,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  template_name text not null check (char_length(template_name) between 1 and 512),
  template_language text not null check (char_length(template_language) between 2 and 10),
  status text not null default 'pending'
    check (status in ('pending','sending','accepted','sent','delivered','read','failed','uncertain','cancelled')),
  wamid text unique check (char_length(wamid) <= 200),
  error_code text check (char_length(error_code) <= 40),
  error_message text check (char_length(error_message) <= 1000),
  status_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id, client_id, recipient_id) references public.client_recipients(agency_id, client_id, id) on delete restrict,
  foreign key (agency_id, report_version_id) references public.report_versions(agency_id, id) on delete restrict
);
create index report_deliveries_agency_idx on public.report_deliveries(agency_id, created_at desc);
create index report_deliveries_version_idx on public.report_deliveries(agency_id, report_version_id);

create table private.whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  dedup_key text not null unique check (char_length(dedup_key) <= 300),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.whatsapp_connections enable row level security;
alter table public.report_deliveries enable row level security;
alter table private.whatsapp_webhook_events enable row level security;
revoke all on public.whatsapp_connections, public.report_deliveries from public, anon, authenticated;
revoke all on private.whatsapp_webhook_events from public, anon, authenticated;
grant select on public.whatsapp_connections, public.report_deliveries to authenticated;
grant all on public.whatsapp_connections, public.report_deliveries, private.whatsapp_webhook_events to service_role;
grant usage, select on sequence private.whatsapp_webhook_events_id_seq to service_role;

create policy whatsapp_connections_read on public.whatsapp_connections for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_deliveries_read on public.report_deliveries for select to authenticated
  using (private.agency_role(agency_id) is not null);

-- Webhook statuses arrive out of order. A delivery never moves back (read beats delivered
-- beats sent), while a failure is always recorded.
create function public.apply_whatsapp_status(p_wamid text, p_status text, p_at timestamptz, p_error_code text, p_error_message text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rank int; v_current_rank int; v_current public.report_deliveries;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_status not in ('sent','delivered','read','failed') then return false; end if;
  select * into v_current from public.report_deliveries where wamid = p_wamid for update;
  if not found then return false; end if;
  v_rank := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  v_current_rank := case v_current.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
  if p_status <> 'failed' and v_rank <= v_current_rank then
    return false;
  end if;
  update public.report_deliveries set status = p_status, status_at = coalesce(p_at, now()), updated_at = now(),
    error_code = case when p_status = 'failed' then left(p_error_code, 40) else error_code end,
    error_message = case when p_status = 'failed' then left(p_error_message, 1000) else error_message end
  where id = v_current.id;
  return true;
end $$;
revoke all on function public.apply_whatsapp_status(text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.apply_whatsapp_status(text, text, timestamptz, text, text) to service_role;

-- Stores a webhook payload once and returns false when the same event was already received.
create function public.record_whatsapp_webhook(p_dedup_key text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  insert into private.whatsapp_webhook_events(dedup_key, payload) values (p_dedup_key, p_payload) on conflict (dedup_key) do nothing;
  return found;
end $$;
revoke all on function public.record_whatsapp_webhook(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_whatsapp_webhook(text, jsonb) to service_role;
