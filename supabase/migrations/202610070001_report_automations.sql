-- Scheduled report messages: a text with variables (investment, results...) sent to chosen
-- recipients or WhatsApp groups on a schedule, plus the history of each run.

create table public.report_automations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  message_template text not null check (char_length(message_template) between 1 and 4000),
  period_key text not null default 'last_7d'
    check (period_key in ('yesterday','last_7d','last_14d','last_30d','this_month','last_month')),
  frequency text not null default 'weekly' check (frequency in ('daily','weekly','monthly')),
  weekdays smallint[] not null default '{1}' check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  month_day smallint not null default 1 check (month_day between 1 and 28),
  send_time time not null default '08:00',
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 3 and 64),
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete restrict,
  unique (agency_id, id)
);
create index report_automations_due_idx on public.report_automations(next_run_at) where active;
create index report_automations_client_idx on public.report_automations(agency_id, client_id);

-- A target is either an authorized recipient or a WhatsApp group (QR connection only).
create table public.report_automation_targets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  automation_id uuid not null,
  recipient_id uuid,
  client_id uuid not null,
  group_id text check (char_length(group_id) <= 120),
  group_name text check (char_length(group_name) <= 200),
  created_at timestamptz not null default now(),
  foreign key (agency_id, automation_id) references public.report_automations(agency_id, id) on delete cascade,
  foreign key (agency_id, client_id, recipient_id) references public.client_recipients(agency_id, client_id, id) on delete cascade,
  check ((recipient_id is not null) <> (group_id is not null))
);
create unique index report_automation_targets_recipient_idx on public.report_automation_targets(automation_id, recipient_id) where recipient_id is not null;
create unique index report_automation_targets_group_idx on public.report_automation_targets(automation_id, group_id) where group_id is not null;

create table public.report_automation_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  automation_id uuid not null,
  scheduled_for timestamptz not null,
  status text not null default 'running' check (status in ('running','sent','partial','failed','skipped')),
  date_from date,
  date_to date,
  message_text text check (char_length(message_text) <= 6000),
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text check (char_length(error_message) <= 1000),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (agency_id, automation_id) references public.report_automations(agency_id, id) on delete cascade,
  unique (automation_id, scheduled_for)
);
create index report_automation_runs_agency_idx on public.report_automation_runs(agency_id, created_at desc);

alter table public.report_automations enable row level security;
alter table public.report_automation_targets enable row level security;
alter table public.report_automation_runs enable row level security;
revoke all on public.report_automations, public.report_automation_targets, public.report_automation_runs from public, anon, authenticated;
grant select, insert, update, delete on public.report_automations, public.report_automation_targets to authenticated;
grant select on public.report_automation_runs to authenticated;
grant all on public.report_automations, public.report_automation_targets, public.report_automation_runs to service_role;

create policy report_automations_read on public.report_automations for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_automations_write on public.report_automations for all to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]))
  with check (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
create policy report_automation_targets_read on public.report_automation_targets for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_automation_targets_write on public.report_automation_targets for all to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]))
  with check (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
create policy report_automation_runs_read on public.report_automation_runs for select to authenticated
  using (private.agency_role(agency_id) is not null);

-- Scheduled runs read the client's numbers without a signed-in user: same authorized path
-- as the dashboard, executed as the agency owner and restored afterwards. Service key only.
create function public.service_client_analytics(p_client_id uuid, p_date_from date, p_date_to date)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_owner uuid; v_previous text := current_setting('request.jwt.claim.sub', true); v_payload jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select au.user_id into v_owner
  from public.clients c join public.agency_users au on au.agency_id = c.agency_id
  where c.id = p_client_id and c.archived_at is null and au.role = 'owner'
  order by au.created_at, au.user_id limit 1;
  if v_owner is null then return null; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    v_payload := public.get_client_analytics(p_client_id, p_date_from, p_date_to, null);
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_previous, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_previous, ''), true);
  return v_payload;
end $$;
revoke all on function public.service_client_analytics(uuid, date, date) from public, anon, authenticated;
grant execute on function public.service_client_analytics(uuid, date, date) to service_role;
