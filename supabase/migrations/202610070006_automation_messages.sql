-- One row per message sent by a schedule (own number by QR Code), with delivery and read
-- confirmations reported by WhatsApp. Written only by the server; members read their agency's.
create table public.automation_messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  run_id uuid not null references public.report_automation_runs(id) on delete cascade,
  automation_id uuid not null,
  client_id uuid not null,
  recipient_id uuid,
  group_id text check (char_length(group_id) <= 120),
  destination_label text not null check (char_length(destination_label) between 1 and 200),
  message_id text check (char_length(message_id) <= 200),
  status text not null default 'sent' check (status in ('sent','delivered','read','failed')),
  error_message text check (char_length(error_message) <= 500),
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  foreign key (agency_id, automation_id) references public.report_automations(agency_id, id) on delete cascade
);
create index automation_messages_agency_idx on public.automation_messages(agency_id, sent_at desc);
create index automation_messages_run_idx on public.automation_messages(run_id);
create unique index automation_messages_message_idx on public.automation_messages(message_id) where message_id is not null;

alter table public.automation_messages enable row level security;
revoke all on public.automation_messages from public, anon, authenticated;
grant select on public.automation_messages to authenticated;
grant all on public.automation_messages to service_role;
create policy automation_messages_read on public.automation_messages for select to authenticated
  using (private.agency_role(agency_id) is not null);
